// Pruebas unitarias del flujo B (oportunidad del Hub → empresa, factura y contacto en Clientify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearClienteClientify, ErrorClientify } from '../../lib/clientify/cliente.js';
import { construirContactoReferido, resumenReferido, sincronizarEmpresa } from '../../lib/clientify/empresas.js';

const EMPRESA = {
  empresa_id: '99999999-8888-7777-6666-555555555555',
  codigo_aliado: 'EMJJPL7K4MQ9TX',
  empresa: 'Industrias Sol', sector: 'Industrial', subsector: 'Manufactura', ciudad: 'Bucaramanga',
  nombre_contacto: 'Laura Gómez Ruiz', cargo: 'Gerente', telefono: '+573105551234', correo: 'laura+prueba@cliente.test',
  valor_factura: 4500000, observaciones: 'Cubierta propia', es_perfecto: true,
  clientify_company_id: null, clientify_contact_id: null,
  factura_storage_path: 'a/e/factura.pdf', factura_nombre: 'factura.pdf', factura_tipo: 'pdf', factura_subida: false
};

function clientifyFalso({ empresaExistente = null, contactoExistente = null, fallos = {} } = {}) {
  const llamadas = [];
  const paso = (nombre, valor) => { llamadas.push(nombre); if (fallos[nombre]) throw fallos[nombre]; return valor; };
  return {
    llamadas,
    buscarEmpresaPorNombre: async () => paso('buscarEmpresa', empresaExistente),
    crearEmpresa: async (d) => paso('crearEmpresa', { id: 300, url: 'https://clientify.test/v1/companies/300/', ...d }),
    urlEmpresa: (e) => e.url || `https://clientify.test/v1/companies/${e.id}/`,
    subirDocumentoEmpresa: async (id, doc) => paso('subirFactura', { id: 1, company: id, nombre: doc.nombre }),
    buscarContactoPorCorreo: async () => paso('buscarContacto', contactoExistente),
    crearContacto: async (d) => paso('crearContacto', { id: 400, ...d }),
    actualizarContacto: async (id, d) => paso('actualizarContacto', { id, ...d }),
    agregarEtiqueta: async (id, n) => paso('etiqueta:' + n, { name: n })
  };
}
const descargarFactura = async () => ({ contenido: Buffer.from('%PDF-1.4 prueba'), tipo: 'application/pdf' });

test('el contacto lleva ID_aliado, la etiqueta de perfecto/imperfecto, el vínculo a la empresa y el resumen', () => {
  const c = construirContactoReferido(EMPRESA, 'production', 'https://clientify.test/v1/companies/300/');
  assert.deepEqual(c.tags, ['Referido perfecto']);
  assert.deepEqual(c.custom_fields, [{ field: 'ID_aliado', value: 'EMJJPL7K4MQ9TX' }]);
  assert.equal(c.company, 'https://clientify.test/v1/companies/300/');
  assert.equal(c.title, 'Gerente');
  assert.deepEqual([c.first_name, c.last_name], ['Laura', 'Gómez Ruiz']);
  assert.deepEqual(construirContactoReferido({ ...EMPRESA, es_perfecto: false }, 'preview', 'u').tags, ['Referido imperfecto', 'PRUEBA HUB']);
  assert.match(resumenReferido(EMPRESA), /Valor mensual de la factura de energía: \$ 4\.500\.000 COP/);
  assert.ok(!JSON.stringify(c).includes(EMPRESA.empresa_id), 'no se envían ids internos');
  assert.ok(!('contact_type' in c), 'el referido no lleva el Tipo "Aliados Estratégicos" (solo los aliados)');
});

test('flujo completo: crea la empresa, adjunta la factura y crea el contacto vinculado', async () => {
  const clientify = clientifyFalso();
  const r = await sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', descargarFactura });
  assert.deepEqual(r, { companyId: '300', contactId: '400', facturaSubida: true });
  assert.deepEqual(clientify.llamadas, ['buscarEmpresa', 'crearEmpresa', 'subirFactura', 'buscarContacto', 'crearContacto']);
});

test('si la empresa ya existe en Clientify (mismo nombre) se reutiliza', async () => {
  const clientify = clientifyFalso({ empresaExistente: { id: 42, name: 'industrias sol' } });
  const r = await sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', descargarFactura });
  assert.equal(r.companyId, '42');
  assert.ok(!clientify.llamadas.includes('crearEmpresa'));
});

test('un reintento no repite lo ya hecho (empresa creada y factura subida)', async () => {
  const clientify = clientifyFalso();
  const r = await sincronizarEmpresa({ ...EMPRESA, clientify_company_id: '300', factura_subida: true },
    { clientify, entorno: 'preview', descargarFactura });
  assert.equal(r.contactId, '400');
  assert.deepEqual(clientify.llamadas, ['buscarContacto', 'crearContacto']);
});

test('si falla un paso, el error lleva lo ya creado para no duplicarlo', async () => {
  const clientify = clientifyFalso({ fallos: { crearContacto: new ErrorClientify('503', { status: 503 }) } });
  await assert.rejects(sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', descargarFactura }),
    (e) => e.reintentable && e.parcial.companyId === '300' && e.parcial.facturaSubida === true && e.parcial.contactId === null);
});

test('contacto existente sin aliado: se vincula a la empresa y recibe ID_aliado y etiquetas', async () => {
  const clientify = clientifyFalso({ contactoExistente: { id: 77, email: EMPRESA.correo, custom_fields: [] } });
  const r = await sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', descargarFactura });
  assert.equal(r.contactId, '77');
  assert.ok(!clientify.llamadas.includes('crearContacto'));
  assert.ok(clientify.llamadas.includes('actualizarContacto') && clientify.llamadas.includes('etiqueta:Referido perfecto'));
});

test('contacto existente de OTRO aliado: no se cambia la atribución, queda para revisión', async () => {
  const clientify = clientifyFalso({ contactoExistente: { id: 77, email: EMPRESA.correo, custom_fields: [{ field: 'ID_aliado', value: 'LKOTRO2345678' }] } });
  await assert.rejects(sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', descargarFactura }),
    (e) => !e.reintentable && /otro ID_aliado/.test(e.message) && !clientify.llamadas.includes('actualizarContacto'));
});

test('fuera de Production, un contacto sin +prueba no se envía a Clientify', async () => {
  const clientify = clientifyFalso();
  await assert.rejects(sincronizarEmpresa({ ...EMPRESA, correo: 'real@cliente.com' }, { clientify, entorno: 'preview', descargarFactura }),
    (e) => !e.reintentable);
  assert.equal(clientify.llamadas.length, 0);
});

test('cliente HTTP: busca empresa por nombre exacto y adjunta la factura como multipart', async () => {
  const pedidas = [];
  const respuestas = [
    { status: 200, body: { count: 2, results: [{ id: 1, name: 'Industrias Sol S.A.S.' }, { id: 2, name: 'INDUSTRIAS SOL' }] } },
    { status: 201, body: { id: 9 } }
  ];
  const fetchFalso = async (url, opciones) => {
    pedidas.push({ url, opciones });
    const r = respuestas.shift();
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  const cliente = crearClienteClientify({ apiKey: 'clave', urlBase: 'https://clientify.test/v1', fetchImpl: fetchFalso });
  assert.equal((await cliente.buscarEmpresaPorNombre('Industrias Sol')).id, 2, 'ignora nombres parecidos');
  await cliente.subirDocumentoEmpresa(2, { nombre: 'factura.pdf', tipo: 'application/pdf', contenido: Buffer.from('%PDF') });
  const envio = pedidas[1];
  assert.equal(envio.url, 'https://clientify.test/v1/companies/2/files/');
  assert.ok(envio.opciones.body instanceof FormData);
  assert.equal(envio.opciones.body.get('file').name, 'factura.pdf');
  assert.equal(envio.opciones.headers['Content-Type'], undefined, 'fetch pone el multipart con su boundary');
  assert.equal(cliente.urlEmpresa({ id: 7 }), 'https://clientify.test/v1/companies/7/');
});
