// Derivación del avance (CLAUDE.md §8): una prueba por fila de las tablas A, B y C, y la lectura de Clientify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivarAvance, elegirOportunidad, normalizarTexto, numeroDeFase } from '../../lib/clientify/avance.js';
import { interpretarWebhook, leerContacto, leerOportunidad } from '../../lib/clientify/mapeo.js';

const contacto = (status, etiquetas = []) => ({ status, etiquetas, leadScoring: null });
const op = (fase, estado = 'abierta') => ({ id: '9', fase, estado, valor: null });
const v = (datos, actual) => derivarAvance(datos, actual).variables;

test('A. Status del contacto → calificado (cada fila)', () => {
  const casos = [
    ['0. lead no calificado', 'no'], ['3. lead caliente', 'si'], ['4. en oportunidad', 'si'], ['5. cliente', 'si'],
    ['0. contacto alternativo', 'revision'], ['0. lead verificado', 'revision'], ['1. lead frío', 'revision'],
    ['2. lead templado', 'revision'], ['0. lead perdido', 'revision']
  ];
  for (const [status, esperado] of casos) assert.equal(v({ contacto: contacto(status) }).calificado, esperado, status);
});

test('A. "0. cliente perdido" no cambia nada (ya fue si)', () => {
  const r = derivarAvance({ contacto: contacto('0. Cliente Perdido') }, { calificado: 'si' });
  assert.equal(r.variables.calificado, 'revision');
  assert.equal(r.variables.integridad_informacion, 'si', 'las derivadas usan el valor vigente del Hub');
  assert.deepEqual(r.avisos, []);
});

test('A. textos normalizados: mayúsculas, tildes, espacios y sin prefijo', () => {
  assert.equal(v({ contacto: contacto('  3.  LEAD   Caliente ') }).calificado, 'si');
  assert.equal(v({ contacto: contacto('1. Lead Frio') }).calificado, 'revision');
  assert.equal(v({ contacto: contacto('Lead no calificado') }).calificado, 'no');
  assert.equal(normalizarTexto('Diseña tu PROYECTO'), 'disena tu proyecto');
});

test('A. Status desconocido → revision y aviso, nunca puntos', () => {
  const r = derivarAvance({ contacto: contacto('9. Otro estado') });
  assert.equal(r.variables.calificado, 'revision');
  assert.match(r.avisos[0], /Status de contacto desconocido: "9. Otro estado"/);
});

test('B. Fase de la oportunidad → avance comercial (mayor o igual)', () => {
  const tabla = [
    ['1. Diseña tu proyecto', 'revision', 'revision', 'revision'],
    ['2. Agendamiento visita técnica', 'revision', 'revision', 'revision'],
    ['3. Diseño', 'si', 'revision', 'revision'],
    ['4. Modelamiento de PPA', 'si', 'revision', 'revision'],
    ['5. Asignación de presentación', 'si', 'revision', 'revision'],
    ['6. Presentación de oferta', 'si', 'si', 'revision'],
    ['7. Interesado No ahora', 'si', 'si', 'revision'],
    ['9. Financiación', 'si', 'si', 'revision'],
    ['10. Contrato', 'si', 'si', 'si']
  ];
  for (const [fase, tecnica, propuesta, cierre] of tabla) {
    const r = v({ contacto: contacto('4. en oportunidad'), oportunidad: op(fase) });
    assert.deepEqual([r.oportunidad_tecnica, r.propuesta_comercial, r.negocio_cerrado], [tecnica, propuesta, cierre], fase);
  }
});

test('B. evaluación técnica = no si no calificó o si se perdió antes de la fase 3', () => {
  assert.equal(v({ contacto: contacto('0. lead no calificado') }).oportunidad_tecnica, 'no');
  assert.equal(v({ contacto: contacto('3. lead caliente'), oportunidad: op('2. Agendamiento visita técnica', 'perdida') }).oportunidad_tecnica, 'no');
  assert.equal(v({ contacto: contacto('3. lead caliente'), oportunidad: op('4. Modelamiento de PPA', 'perdida') }).oportunidad_tecnica, 'si',
    'perdida después de la fase 3: ya tuvo evaluación técnica');
  assert.equal(v({ contacto: contacto('3. lead caliente') }).oportunidad_tecnica, 'revision', 'sin oportunidad: en revisión');
});

test('B. fase desconocida (la 8 no existe) → revision y aviso', () => {
  const r = derivarAvance({ contacto: contacto('4. en oportunidad'), oportunidad: op('8. Fase inventada') });
  assert.deepEqual([r.variables.oportunidad_tecnica, r.variables.propuesta_comercial], ['revision', 'revision']);
  assert.match(r.avisos[0], /Fase de oportunidad desconocida/);
  assert.equal(r.crudos.fase_oportunidad_num, 8, 'el dato crudo se guarda igual');
  assert.equal(numeroDeFase('Sin número'), null);
});

test('B. con varias oportunidades se usa la más avanzada', () => {
  const elegida = elegirOportunidad([op('3. Diseño'), { ...op('10. Contrato'), id: 'x' }, op('6. Presentación de oferta'), op('sin fase')]);
  assert.equal(elegida.id, 'x');
  assert.equal(elegirOportunidad([]), null);
});

test('C. integridad y perfecto', () => {
  assert.equal(v({ contacto: contacto('0. lead no calificado') }).integridad_informacion, 'no');
  assert.equal(v({ contacto: contacto('3. lead caliente') }).integridad_informacion, 'si');
  assert.equal(v({ contacto: contacto('1. lead frío') }).integridad_informacion, 'revision');
  assert.equal(v({ contacto: contacto(null, ['Referido perfecto']) }).perfecto, 'si');
  assert.equal(v({ contacto: contacto(null, ['REFERIDO IMPERFECTO']) }).perfecto, 'no');
  assert.equal(v({ contacto: contacto(null, ['Otra']) }).perfecto, 'revision');
});

test('C. fuera del perfil: si solo con no calificado y perfecto', () => {
  assert.equal(v({ contacto: contacto('0. lead no calificado', ['Referido perfecto']) }).fuera_perfil, 'si');
  assert.equal(v({ contacto: contacto('0. lead no calificado', ['Referido imperfecto']) }).fuera_perfil, 'no');
  assert.equal(v({ contacto: contacto('3. lead caliente', ['Referido perfecto']) }).fuera_perfil, 'no');
  assert.equal(v({ contacto: contacto('2. lead templado', ['Referido perfecto']) }).fuera_perfil, 'revision');
  assert.equal(v({ contacto: contacto('0. lead no calificado') }).fuera_perfil, 'revision', 'sin saber si era perfecto');
  assert.equal(v({ contacto: contacto('0. lead no calificado') }, { perfecto: 'si' }).fuera_perfil, 'si',
    'usa el perfecto vigente del Hub (referido del Hub)');
});

test('C. información falsa: sin el nombre de la etiqueta confirmado queda en revisión', () => {
  assert.equal(v({ contacto: contacto('3. lead caliente', ['Información falsa']) }).informacion_falsa, 'revision');
});

test('D. datos crudos para dashboards; los campos sin confirmar no se tocan', () => {
  const r = derivarAvance({ contacto: { ...contacto('4. en oportunidad'), leadScoring: 80 },
    oportunidad: { id: '5', fase: '6. Presentación de oferta', estado: 'abierta', valor: 250000000 } });
  assert.deepEqual(r.crudos, {
    estado_contacto_clientify: '4. en oportunidad', lead_scoring: 80, fase_oportunidad: '6. Presentación de oferta',
    fase_oportunidad_num: 6, estado_oportunidad: 'abierta', valor_oportunidad: 250000000
  });
  assert.ok(!('valor_cotizado' in r.crudos) && !('potencia_instalada_kwp' in r.crudos));
});

test('lectura de contactos y oportunidades de la API', () => {
  const c = leerContacto({
    id: 77, first_name: 'Laura', last_name: 'Gómez', emails: [{ email: 'laura@x.test' }], phones: [{ phone: '+573001112233' }],
    status: '3. lead caliente', tags: ['Referido perfecto', { name: 'PRUEBA HUB' }], lead_scoring: '72',
    custom_fields: [{ field: 'ID_aliado', value: 'EMJJPL7K4MQ9TX' }]
  });
  assert.deepEqual([c.id, c.nombre, c.correo, c.telefono, c.status, c.idAliado, c.leadScoring],
    ['77', 'Laura Gómez', 'laura@x.test', '+573001112233', '3. lead caliente', 'EMJJPL7K4MQ9TX', 72]);
  assert.deepEqual(c.etiquetas, ['Referido perfecto', 'PRUEBA HUB']);

  const o = leerOportunidad({ id: 5, contact: 'https://api.clientify.net/v1/contacts/77/', pipeline_stage_desc: '3. Diseño',
    status: 3, amount: '120.000.000' });
  assert.deepEqual([o.id, o.contactos, o.fase, o.estado, o.valor], ['5', ['77'], '3. Diseño', 'perdida', 120000000]);
});

test('interpretación del webhook', () => {
  assert.deepEqual(interpretarWebhook({ hook: { event: 'contact.created' }, data: { id: 77 } }),
    { entidad: 'contacto', entidadId: '77', accion: 'contact.created' });
  assert.deepEqual(interpretarWebhook({ event: 'deal.updated', data: { id: 5 } }),
    { entidad: 'oportunidad', entidadId: '5', accion: 'deal.updated' });
  assert.deepEqual(interpretarWebhook({ action: 'update', url: 'https://api.clientify.net/v1/deals/12/' }),
    { entidad: 'oportunidad', entidadId: '12', accion: 'update' });
  assert.deepEqual(interpretarWebhook({ algo: 'raro' }), { entidad: null, entidadId: null, accion: null });
  assert.deepEqual(interpretarWebhook(null), { entidad: null, entidadId: null, accion: null });
});
