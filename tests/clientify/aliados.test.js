// Pruebas unitarias del flujo A (aliado aprobado → Clientify) y del cliente HTTP. Ejecutar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearClienteClientify, ErrorClientify } from '../../lib/clientify/cliente.js';
import { construirContacto, separarNombre, sincronizarAliado, validarEntorno } from '../../lib/clientify/aliados.js';

const ALIADO = {
  aliado_id: '11111111-2222-3333-4444-555555555555',
  codigo_aliado: 'EMJJPL7K4MQ9TX',
  nombre_completo: 'Juan José Pérez León',
  correo: 'juan+prueba@geenera.test',
  celular: '+573001234567',
  regional: 'Santander',
  tipo_aliado: 'emi',
  organizacion: null,
  cargo: null,
  clientify_contact_id: null
};

// Clientify simulado en memoria: registra cada llamada.
function clientifyFalso({ existente = null, fallos = {} } = {}) {
  const llamadas = [];
  const enviados = {};
  const responder = (nombre, valor) => {
    llamadas.push(nombre);
    if (fallos[nombre]) throw fallos[nombre];
    return valor;
  };
  return {
    llamadas,
    enviados,
    buscarContactoPorCorreo: async (correo) => { llamadas.push('buscar'); return existente && existente.email === correo ? existente : null; },
    crearContacto: async (datos) => { enviados.crear = datos; return responder('crear', { id: 1001, ...datos }); },
    actualizarContacto: async (id, datos) => { enviados.actualizar = datos; return responder('actualizar', { id, ...datos }); },
    agregarEtiqueta: async (id, nombre) => responder('etiqueta:' + nombre, { name: nombre })
  };
}

test('separa el nombre en nombre y apellidos sin perder palabras', () => {
  assert.deepEqual(separarNombre('Ana'), { first_name: 'Ana', last_name: '' });
  assert.deepEqual(separarNombre('Ana Ruiz'), { first_name: 'Ana', last_name: 'Ruiz' });
  assert.deepEqual(separarNombre('Ana Ruiz Gómez'), { first_name: 'Ana', last_name: 'Ruiz Gómez' });
  assert.deepEqual(separarNombre('  Juan   José Pérez León '), { first_name: 'Juan José', last_name: 'Pérez León' });
});

test('en Production: etiqueta "Aliado del Sol", etiqueta del tipo e ID_aliado; nunca el id interno', () => {
  const contacto = construirContacto(ALIADO, 'production');
  assert.deepEqual(contacto.tags, ['aliados del sol', 'AdS EMI']);
  assert.deepEqual(contacto.custom_fields, [{ field: 'ID_aliado', value: 'EMJJPL7K4MQ9TX' }]);
  assert.equal(contacto.email, ALIADO.correo);
  assert.equal(contacto.phone, '+573001234567');
  assert.ok(!JSON.stringify(contacto).includes(ALIADO.aliado_id), 'el id interno no se envía a Clientify');
});

test('fuera de Production agrega la etiqueta PRUEBA HUB', () => {
  assert.deepEqual(construirContacto(ALIADO, 'preview').tags, ['aliados del sol', 'AdS EMI', 'PRUEBA HUB']);
  assert.deepEqual(construirContacto({ ...ALIADO, tipo_aliado: 'agremiaciones', cargo: 'Directora' }, 'development').tags,
    ['aliados del sol', 'AdS Agremiaciones', 'PRUEBA HUB']);
  assert.deepEqual(construirContacto({ ...ALIADO, tipo_aliado: 'cliente_embajador' }, 'production').tags,
    ['aliado del sol hub', 'AdS Cliente Embajador'], 'Cliente Embajador lleva "aliado del sol hub"');
  assert.equal(construirContacto({ ...ALIADO, cargo: 'Directora' }, 'production').title, 'Directora');
});

test('fuera de Production solo se sincronizan correos con +prueba', () => {
  assert.throws(() => validarEntorno({ ...ALIADO, correo: 'real@empresa.com' }, 'preview'), ErrorClientify);
  assert.doesNotThrow(() => validarEntorno(ALIADO, 'preview'));
  assert.doesNotThrow(() => validarEntorno({ ...ALIADO, correo: 'real@empresa.com' }, 'production'));
});

test('aliado nuevo en Clientify: se crea el contacto con etiquetas e ID_aliado', async () => {
  const clientify = clientifyFalso();
  const r = await sincronizarAliado(ALIADO, { clientify, entorno: 'preview' });
  assert.deepEqual(r, { contactId: '1001', accion: 'creado' });
  assert.deepEqual(clientify.llamadas, ['buscar', 'crear']);
});

test('contacto que ya existía (p. ej. un cliente): se vincula sin pisar sus datos', async () => {
  const clientify = clientifyFalso({ existente: { id: 555, email: ALIADO.correo } });
  const r = await sincronizarAliado(ALIADO, { clientify, entorno: 'preview' });
  assert.deepEqual(r, { contactId: '555', accion: 'vinculado' });
  assert.deepEqual(clientify.llamadas, ['buscar', 'actualizar', 'etiqueta:aliados del sol', 'etiqueta:AdS EMI', 'etiqueta:PRUEBA HUB']);
});

test('aliado ya sincronizado que editó su perfil: se actualiza el mismo contacto', async () => {
  const clientify = clientifyFalso();
  const r = await sincronizarAliado({ ...ALIADO, clientify_contact_id: '777' }, { clientify, entorno: 'production' });
  assert.deepEqual(r, { contactId: '777', accion: 'actualizado' });
  assert.deepEqual(clientify.llamadas, ['actualizar', 'etiqueta:aliados del sol', 'etiqueta:AdS EMI']);
});

test('Tipo de Clientify: todo aliado llega como "Aliados Estratégicos", sin importar su tipo_aliado', async () => {
  for (const tipo_aliado of ['financiero', 'emi', 'linker', 'cliente_embajador', 'agremiaciones']) {
    assert.equal(construirContacto({ ...ALIADO, tipo_aliado }, 'production').contact_type, 'Aliados Estratégicos', tipo_aliado);
  }
  // El tipo_aliado del Hub sigue definiendo su etiqueta; el Tipo de Clientify es otro campo.
  assert.ok(construirContacto({ ...ALIADO, tipo_aliado: 'linker' }, 'production').tags.includes('AdS Linker'));

  const nuevo = clientifyFalso();
  await sincronizarAliado(ALIADO, { clientify: nuevo, entorno: 'preview' });
  assert.equal(nuevo.enviados.crear.contact_type, 'Aliados Estratégicos', 'contacto creado');

  const existente = clientifyFalso({ existente: { id: 555, email: ALIADO.correo } });
  await sincronizarAliado(ALIADO, { clientify: existente, entorno: 'preview' });
  assert.deepEqual(existente.enviados.actualizar, {
    contact_type: 'Aliados Estratégicos', custom_fields: [{ field: 'ID_aliado', value: 'EMJJPL7K4MQ9TX' }]
  }, 'contacto vinculado: solo Tipo e ID_aliado, sin pisar nombre ni teléfono');

  const sincronizado = clientifyFalso();
  await sincronizarAliado({ ...ALIADO, clientify_contact_id: '777' }, { clientify: sincronizado, entorno: 'production' });
  assert.equal(sincronizado.enviados.actualizar.contact_type, 'Aliados Estratégicos', 'contacto actualizado');
});

test('si el contacto guardado ya no existe en Clientify (404), se busca o se crea de nuevo', async () => {
  const clientify = clientifyFalso({ fallos: { actualizar: new ErrorClientify('404', { status: 404, reintentable: false }) } });
  const r = await sincronizarAliado({ ...ALIADO, clientify_contact_id: '777' }, { clientify, entorno: 'preview' });
  assert.equal(r.accion, 'creado');
});

test('una etiqueta que ya existe (4xx) no hace fallar la sincronización; un 5xx sí', async () => {
  const yaExiste = new ErrorClientify('400', { status: 400, reintentable: false });
  const ok = await sincronizarAliado({ ...ALIADO, clientify_contact_id: '777' },
    { clientify: clientifyFalso({ fallos: { 'etiqueta:AdS EMI': yaExiste } }), entorno: 'production' });
  assert.equal(ok.accion, 'actualizado');
  await assert.rejects(
    sincronizarAliado(ALIADO, { clientify: clientifyFalso({ fallos: { crear: new ErrorClientify('503', { status: 503 }) } }), entorno: 'preview' }),
    (e) => e instanceof ErrorClientify && e.reintentable
  );
});

test('cliente HTTP: envía "Authorization: Token", busca por correo exacto y clasifica errores', async () => {
  const pedidas = [];
  const respuestas = [
    { status: 200, body: { count: 2, results: [{ id: 1, emails: [{ email: 'otro+juan+prueba@geenera.test' }] }, { id: 2, emails: [{ email: 'Juan+Prueba@Geenera.test' }] }] } },
    { status: 503, body: { detail: 'Mantenimiento' } },
    { status: 400, body: { email: ['inválido'] } }
  ];
  const fetchFalso = async (url, opciones) => {
    pedidas.push({ url, opciones });
    const r = respuestas.shift();
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  const cliente = crearClienteClientify({ apiKey: 'clave', urlBase: 'https://clientify.test/v1', fetchImpl: fetchFalso });

  const encontrado = await cliente.buscarContactoPorCorreo('juan+prueba@geenera.test');
  assert.equal(encontrado.id, 2, 'ignora coincidencias parciales');
  assert.equal(pedidas[0].opciones.headers.Authorization, 'Token clave');
  assert.equal(pedidas[0].url, 'https://clientify.test/v1/contacts/?email=juan%2Bprueba%40geenera.test');

  await assert.rejects(cliente.crearContacto({}), (e) => e.status === 503 && e.reintentable && /Mantenimiento/.test(e.message));
  await assert.rejects(cliente.crearContacto({}), (e) => e.status === 400 && !e.reintentable);
  assert.throws(() => crearClienteClientify({ apiKey: '' }), ErrorClientify);
});

test('cola: si Clientify devuelve el contacto de otro aliado, el error dice la causa', async () => {
  const { procesarAliados } = await import('../../lib/clientify/cola.js');
  const resultados = [];
  const supabase = {
    rpc: async (nombre, args) => {
      if (nombre === 'clientify_reclamar_aliados') return { data: [ALIADO], error: null };
      resultados.push(args);
      return args.p_contact_id ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } } : { data: null, error: null };
    }
  };
  const r = await procesarAliados({ supabase, clientify: clientifyFalso(), entorno: 'preview' });
  assert.equal(r.errores, 1);
  assert.match(r.detalle[0].error, /otro aliado .*celular/);
  assert.equal(resultados.at(-1).p_contact_id, null);
  assert.match(resultados.at(-1).p_error, /otro aliado/);
});
