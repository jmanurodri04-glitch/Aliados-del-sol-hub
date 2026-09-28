// Derivación del avance (CLAUDE.md §8): una prueba por fila de las tablas A, B y C, y la lectura de Clientify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construirCatalogoFases, derivarAvance, elegirOportunidad, hitosDeOportunidad, normalizarTexto, numeroDeFase,
  valoresDelReferido
} from '../../lib/clientify/avance.js';
import { interpretarWebhook, leerContacto, leerOportunidad } from '../../lib/clientify/mapeo.js';
import { FASES_CLIENTIFY, oportunidadEnFase } from './fases.fixture.js';

const catalogo = construirCatalogoFases(FASES_CLIENTIFY);
const contacto = (status, etiquetas = []) => ({ status, etiquetas, leadScoring: null });
const ESTADO_API = { abierta: 'Open', perdida: 'Lost', ganada: 'Won' };
/** Oportunidad leída de la API en una fase real del catálogo, con sus hitos calculados. */
const op = (fase, estado = 'abierta', embudo = 'GEENERA AUTOCONSUMO', extra = {}) => {
  const o = leerOportunidad(oportunidadEnFase(embudo, fase, { status_desc: ESTADO_API[estado], ...extra }));
  o.hitos = hitosDeOportunidad(o, catalogo);
  return o;
};
const hitos = (o) => { const r = v({ contacto: contacto('in-deal'), oportunidad: o }); return [r.oportunidad_tecnica, r.propuesta_comercial, r.negocio_cerrado]; };
const v = (datos, actual) => derivarAvance(datos, actual).variables;

test('A. Status del contacto → calificado (cada fila)', () => {
  const casos = [
    ['0. lead no calificado', 'no'], ['3. lead caliente', 'si'], ['4. en oportunidad', 'si'], ['5. cliente', 'si'],
    ['0. contacto alternativo', 'revision'], ['0. lead verificado', 'revision'], ['1. lead frío', 'revision'],
    ['2. lead templado', 'revision'], ['0. lead perdido', 'revision']
  ];
  for (const [status, esperado] of casos) assert.equal(v({ contacto: contacto(status) }).calificado, esperado, status);
});

test('A. códigos de Status que devuelve la API (confirmados con el diagnóstico)', () => {
  const casos = [
    ['not-qualified-lead', 'no'], ['hot-lead', 'si'], ['in-deal', 'si'], ['client', 'si'],
    ['cold-lead', 'revision'], ['warm-lead', 'revision'], ['lost-lead', 'revision'], ['other', 'revision']
  ];
  for (const [status, esperado] of casos) {
    const r = derivarAvance({ contacto: contacto(status) });
    assert.equal(r.variables.calificado, esperado, status);
    assert.deepEqual(r.avisos, [], status);
  }
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

test('B. GEENERA AUTOCONSUMO: cada fase → avance comercial (mayor o igual)', () => {
  const tabla = [
    ['1. Diseña Tu Proyecto', 'revision', 'revision', 'revision'],
    ['2. Agendamiento Visita Tecnica', 'revision', 'revision', 'revision'],
    ['3. Diseño', 'si', 'revision', 'revision'],
    ['4. Modelamiento de PPA', 'si', 'revision', 'revision'],
    ['5. Asignación de presentación', 'si', 'revision', 'revision'],
    ['6. Presentación de Oferta', 'si', 'si', 'revision'],
    ['7. Interesado no ahora', 'si', 'si', 'revision'],
    ['9. Financiación', 'si', 'si', 'revision'],
    ['10. Contrato', 'si', 'si', 'si']
  ];
  for (const [fase, tecnica, propuesta, cierre] of tabla) assert.deepEqual(hitos(op(fase)), [tecnica, propuesta, cierre], fase);
});

test('B. todos los embudos de proyectos cuentan, con su propio orden de fases', () => {
  // OFF GRID: el diseño es la fase 2 y existe una 8.
  assert.deepEqual(hitos(op('1. Oportunidad', 'abierta', 'GEENERA OFF GRID')), ['revision', 'revision', 'revision']);
  assert.deepEqual(hitos(op('2. Diseño', 'abierta', 'GEENERA OFF GRID')), ['si', 'revision', 'revision']);
  assert.deepEqual(hitos(op('3. Capex', 'abierta', 'GEENERA OFF GRID')), ['si', 'revision', 'revision']);
  assert.deepEqual(hitos(op('8. Actualización de Oferta', 'abierta', 'GEENERA OFF GRID')), ['si', 'si', 'revision']);
  assert.deepEqual(hitos(op('10. Contrato', 'abierta', 'GEENERA OFF GRID')), ['si', 'si', 'si']);
  // MINIGRANJAS: fases sin número.
  assert.deepEqual(hitos(op('Identificación de Negocio', 'abierta', 'GEENERA MINIGRANJAS')), ['revision', 'revision', 'revision']);
  assert.deepEqual(hitos(op('Asignación de presentación de oferta', 'abierta', 'GEENERA MINIGRANJAS')), ['si', 'revision', 'revision']);
  assert.deepEqual(hitos(op('Presentación de oferta', 'abierta', 'GEENERA MINIGRANJAS')), ['si', 'si', 'revision']);
  assert.deepEqual(hitos(op('Contrato', 'abierta', 'GEENERA MINIGRANJAS')), ['si', 'si', 'si']);
  // Care: "Interesado NO ahora" va después de Financiación y antes de Contrato.
  assert.deepEqual(hitos(op('Capex', 'abierta', 'GEENERA_Care')), ['si', 'revision', 'revision']);
  assert.deepEqual(hitos(op('Interesado NO ahora', 'abierta', 'GEENERA_Care')), ['si', 'si', 'revision']);
  assert.deepEqual(hitos(op('Contrato', 'abierta', 'GEENERA_Care')), ['si', 'si', 'si']);
});

test('B. un embudo sin fases de proyecto (eventos, por defecto) no da puntos de avance', () => {
  for (const [embudo, fase] of [['GEENERA_ADS', 'Cierre'], ['Por defecto', 'Propuesta presentada']]) {
    const r = derivarAvance({ contacto: contacto('in-deal'), oportunidad: op(fase, 'abierta', embudo) });
    assert.deepEqual([r.variables.oportunidad_tecnica, r.variables.propuesta_comercial, r.variables.negocio_cerrado],
      ['revision', 'revision', 'revision'], embudo);
    assert.deepEqual(r.avisos, [], 'la fase existe: no es un aviso');
  }
});

test('B. evaluación técnica = no si no calificó o si se perdió antes del diseño', () => {
  assert.equal(v({ contacto: contacto('0. lead no calificado') }).oportunidad_tecnica, 'no');
  assert.equal(v({ contacto: contacto('hot-lead'), oportunidad: op('2. Agendamiento Visita Tecnica', 'perdida') }).oportunidad_tecnica, 'no');
  assert.equal(v({ contacto: contacto('hot-lead'), oportunidad: op('4. Modelamiento de PPA', 'perdida') }).oportunidad_tecnica, 'si',
    'perdida después del diseño: ya tuvo evaluación técnica');
  assert.equal(v({ contacto: contacto('hot-lead'), oportunidad: op('Identificación de Negocio', 'perdida', 'GEENERA MINIGRANJAS') }).oportunidad_tecnica, 'no');
  assert.equal(v({ contacto: contacto('hot-lead') }).oportunidad_tecnica, 'revision', 'sin oportunidad: en revisión');
});

test('B. fase que no está en el catálogo → revision y aviso', () => {
  const o = leerOportunidad({ id: 3, pipeline_stage: 'https://api.clientify.net/v1/deals/pipelines/stages/999999/',
    pipeline_stage_desc: '8. Fase inventada', status_desc: 'Open' });
  o.hitos = hitosDeOportunidad(o, catalogo);
  const r = derivarAvance({ contacto: contacto('in-deal'), oportunidad: o });
  assert.deepEqual([r.variables.oportunidad_tecnica, r.variables.propuesta_comercial], ['revision', 'revision']);
  assert.match(r.avisos[0], /Fase de oportunidad desconocida: "8. Fase inventada"/);
  assert.equal(r.crudos.fase_oportunidad_num, 8, 'el dato crudo se guarda igual');
  assert.equal(numeroDeFase('Sin número'), null);
});

test('B. con varias oportunidades se usa la más avanzada (aunque sean de embudos distintos)', () => {
  const elegida = elegirOportunidad([
    { ...op('3. Diseño'), id: 'a' }, { ...op('Contrato', 'abierta', 'GEENERA MINIGRANJAS'), id: 'x' },
    { ...op('6. Presentación de Oferta'), id: 'b' }, { id: 'sin', hitos: null }
  ]);
  assert.equal(elegida.id, 'x');
  assert.equal(elegirOportunidad([{ ...op('3. Diseño'), id: 'a' }, { ...op('4. Modelamiento de PPA'), id: 'b' }]).id, 'b',
    'mismos hitos: la fase posterior');
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

test('C. información falsa: cualquiera de las tres etiquetas', () => {
  for (const e of ['fraude', 'no existe', 'información de contacto errónea', 'Informacion de contacto erronea']) {
    assert.equal(v({ contacto: contacto('hot-lead', ['otra', e]) }).informacion_falsa, 'si', e);
  }
  assert.equal(v({ contacto: contacto('hot-lead', ['Información falsa', 'no existe x']) }).informacion_falsa, 'revision');
});

test('D. un evento guarda fase y estado; los valores del referido los suma el escaneo', () => {
  const o = op('6. Presentación de Oferta', 'abierta', 'GEENERA AUTOCONSUMO', { amount: '250000000.00' });
  const r = derivarAvance({ contacto: { ...contacto('in-deal'), leadScoring: 80 }, oportunidad: o });
  assert.deepEqual(r.crudos, {
    estado_contacto_clientify: 'in-deal', lead_scoring: 80, fase_oportunidad: '6. Presentación de Oferta',
    fase_oportunidad_num: 6, estado_oportunidad: 'abierta'
  });
  const sinScoring = derivarAvance({ contacto: contacto('in-deal') });
  assert.ok(!('lead_scoring' in sinScoring.crudos), 'el lead scoring no viene en la API: no se borra lo guardado');
});

test('D. valor cotizado = todas las oportunidades; pipeline originado y potencia = las que se cierran', () => {
  const potencia = (kwp) => ({ custom_fields: [{ id: 1, field: 'Potencia (kWp)', value: String(kwp) }] });
  const lista = [
    op('3. Diseño', 'abierta', 'GEENERA AUTOCONSUMO', { amount: '100.00', ...potencia(10) }),
    op('6. Presentación de Oferta', 'perdida', 'GEENERA AUTOCONSUMO', { amount: '200.00', ...potencia(20) }),
    op('Contrato', 'abierta', 'GEENERA MINIGRANJAS', { amount: '300.00', ...potencia(30) }),
    op('9. Financiación', 'ganada', 'GEENERA AUTOCONSUMO', { amount: '400.00', ...potencia(40) })
  ];
  assert.deepEqual(valoresDelReferido(lista), { valor_cotizado: 1000, valor_oportunidad: 700, potencia_instalada_kwp: 70 });
  assert.deepEqual(valoresDelReferido(lista.slice(0, 2)), { valor_cotizado: 300, valor_oportunidad: null, potencia_instalada_kwp: null },
    'sin cierres no hay pipeline originado');
  assert.deepEqual(valoresDelReferido([]), { valor_cotizado: null, valor_oportunidad: null, potencia_instalada_kwp: null });
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

  const o = leerOportunidad({ id: 5, contact: 'https://api.clientify.net/v1/contacts/77/', pipeline_desc: 'GEENERA AUTOCONSUMO',
    pipeline_stage_desc: '3. Diseño', status: 3, status_desc: 'Lost', amount: '120000000.00',
    custom_fields: [{ id: 1, field: 'Potencia (kWp)', value: '85.5' }] });
  assert.deepEqual([o.id, o.contactos, o.embudo, o.fase, o.estado, o.valor, o.potenciaKwp],
    ['5', ['77'], 'GEENERA AUTOCONSUMO', '3. Diseño', 'perdida', 120000000, 85.5]);
  assert.equal(leerOportunidad({ status_desc: 'Expired' }).estado, 'perdida');
  assert.equal(leerOportunidad({ status_desc: 'Open' }).estado, 'abierta');
  assert.equal(leerOportunidad({ status_desc: 'Won' }).estado, 'ganada');
  assert.equal(leerOportunidad({ status: 2 }).estado, null, 'sin status_desc no se adivina');
});

test('datos del contacto para leads del formulario público', () => {
  const c = leerContacto({ id: 8, emails: ['a@x.test'], addresses: [{ city: 'Girón' }],
    custom_fields: [{ field: 'Valor pagado en factura (COP / mes)', value: '3500000' }, { field: 'Subsector Economico', value: 'Avícolas' }] });
  assert.deepEqual([c.correo, c.ciudad, c.valorFactura, c.subsector], ['a@x.test', 'Girón', 3500000, 'Avícolas']);
});

test('interpretación del webhook real de Clientify (confirmado con los primeros eventos)', () => {
  assert.deepEqual(interpretarWebhook({ hook: { id: 1, event: 'deal.saved', target: 'https://x/api/webhooks/clientify' },
    data: { id: 987654, pipeline_stage: 'https://api.clientify.net/v1/deals/pipelines/stages/159064/' } }),
  { entidad: 'oportunidad', entidadId: '987654', accion: 'deal.saved' });
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
