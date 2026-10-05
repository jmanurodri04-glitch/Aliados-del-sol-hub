// Pruebas unitarias del flujo B (oportunidad del Hub → empresa, factura y contacto en Clientify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearClienteClientify, ErrorClientify } from '../../lib/clientify/cliente.js';
import { construirContactoReferido, construirEmpresaReferido, MARCA_FACTURA, resumenReferido, sincronizarEmpresa } from '../../lib/clientify/empresas.js';

const EMPRESA = {
  empresa_id: '99999999-8888-7777-6666-555555555555',
  codigo_aliado: 'EMJJPL7K4MQ9TX',
  empresa: 'Industrias Sol', sector: 'Industrial', subsector: 'Manufactura', ciudad: 'Bucaramanga',
  nombre_contacto: 'Laura Gómez Ruiz', cargo: 'Gerente', telefono: '+573105551234', correo: 'laura+prueba@cliente.test',
  valor_factura: 4500000, observaciones: 'Cubierta propia', es_perfecto: true,
  clientify_company_id: null, clientify_contact_id: null,
  factura_storage_path: 'a/e/factura.pdf', factura_nombre: 'factura.pdf', factura_tipo: 'pdf', factura_subida: false
};

function clientifyFalso({ empresaExistente = null, contactoExistente = null, fallos = {}, descripcion = 'Resumen' } = {}) {
  const llamadas = [];
  const enviados = {};
  const paso = (nombre, valor) => { llamadas.push(nombre); if (fallos[nombre]) throw fallos[nombre]; return valor; };
  return {
    llamadas, enviados,
    buscarEmpresaPorNombre: async () => paso('buscarEmpresa', empresaExistente),
    crearEmpresa: async (d) => { enviados.empresa = d; return paso('crearEmpresa', { id: 300, ...d }); },
    obtenerEmpresa: async (id) => paso('obtenerEmpresa', { id, description: descripcion }),
    actualizarEmpresa: async (id, d) => { enviados.actualizacion = d; return paso('subirFactura', { id, ...d }); },
    buscarContactoPorCorreo: async () => paso('buscarContacto', contactoExistente),
    crearContacto: async (d) => { enviados.contacto = d; return paso('crearContacto', { id: 400, ...d }); },
    actualizarContacto: async (id, d) => paso('actualizarContacto', { id, ...d }),
    agregarEtiqueta: async (id, n) => paso('etiqueta:' + n, { name: n })
  };
}
const enlaceFactura = async (ruta, nombre) => `https://almacen.test/firmado/${ruta}?descarga=${nombre}`;

test('el contacto lleva ID_aliado, la etiqueta, el NOMBRE de la empresa y los campos del antiguo formulario', () => {
  const c = construirContactoReferido(EMPRESA, 'production');
  assert.deepEqual(c.tags, ['Referido perfecto']);
  assert.deepEqual(c.custom_fields, [
    { field: 'ID_aliado', value: 'EMJJPL7K4MQ9TX' },
    { field: 'Subsector Economico', value: 'Manufactura' },
    { field: 'Valor pagado en factura (COP / mes)', value: '4500000' }
  ]);
  assert.equal(c.company, 'Industrias Sol', 'texto: con la URL Clientify creaba otra empresa llamada como la URL');
  assert.equal(c.contact_sector, 'Industrial');
  assert.deepEqual(c.addresses, [{ city: 'Bucaramanga', country: 'co' }]);
  assert.equal(c.title, 'Gerente');
  assert.deepEqual([c.first_name, c.last_name], ['Laura', 'Gómez Ruiz']);
  assert.deepEqual(construirContactoReferido({ ...EMPRESA, es_perfecto: false }, 'preview').tags, ['Referido imperfecto', 'PRUEBA HUB']);
  assert.ok(!('addresses' in construirContactoReferido({ ...EMPRESA, ciudad: null }, 'production')));
  assert.match(resumenReferido(EMPRESA), /Valor mensual de la factura de energía: \$ 4\.500\.000 COP/);
  assert.ok(!JSON.stringify(c).includes(EMPRESA.empresa_id), 'no se envían ids internos');
  assert.ok(!('contact_type' in c), 'el referido no lleva el Tipo "Aliados Estratégicos" (solo los aliados)');
});

test('la empresa nueva lleva sector, ciudad y el resumen del referido', () => {
  assert.deepEqual(construirEmpresaReferido(EMPRESA), {
    name: 'Industrias Sol', company_sector: 'Industrial / Manufactura', description: resumenReferido(EMPRESA),
    addresses: [{ city: 'Bucaramanga', country: 'co' }]
  });
});

test('flujo completo: crea la empresa, el contacto vinculado y deja el enlace de la factura en la empresa', async () => {
  const clientify = clientifyFalso();
  const r = await sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', enlaceFactura });
  assert.deepEqual(r, { companyId: '300', contactId: '400', facturaSubida: true });
  assert.deepEqual(clientify.llamadas, ['buscarEmpresa', 'crearEmpresa', 'buscarContacto', 'crearContacto', 'obtenerEmpresa', 'subirFactura']);
  const d = clientify.enviados.actualizacion.description;
  assert.ok(d.startsWith('Resumen\n\n' + MARCA_FACTURA), 'conserva la descripción y agrega la nota al final');
  assert.match(d, /https:\/\/almacen\.test\/firmado\/a\/e\/factura\.pdf\?descarga=factura\.pdf/);
  assert.match(d, /No lo copies ni lo compartas/);
});

test('un reintento no repite la nota de la factura si ya está en la descripción', async () => {
  const clientify = clientifyFalso({ descripcion: 'Resumen\n\n' + MARCA_FACTURA + ' (factura.pdf): https://x' });
  const r = await sincronizarEmpresa({ ...EMPRESA, clientify_company_id: '300', clientify_contact_id: '400' }, { clientify, entorno: 'preview', enlaceFactura });
  assert.equal(r.facturaSubida, true);
  assert.deepEqual(clientify.llamadas, ['obtenerEmpresa']);
});

test('si Clientify rechaza la dirección (400), la empresa y el contacto se crean sin ella', async () => {
  const clientify = clientifyFalso();
  let intentos = 0;
  const crear = clientify.crearEmpresa;
  clientify.crearEmpresa = async (d) => { intentos++; if (d.addresses) throw new ErrorClientify('400', { status: 400, reintentable: false }); return crear(d); };
  const r = await sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', enlaceFactura });
  assert.equal(r.companyId, '300');
  assert.equal(intentos, 2);
  assert.ok(!('addresses' in clientify.enviados.empresa) && !('company_sector' in clientify.enviados.empresa));
});

test('si la empresa ya existe en Clientify (mismo nombre) se reutiliza', async () => {
  const clientify = clientifyFalso({ empresaExistente: { id: 42, name: 'industrias sol' } });
  const r = await sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', enlaceFactura });
  assert.equal(r.companyId, '42');
  assert.ok(!clientify.llamadas.includes('crearEmpresa'));
});

test('un reintento no repite lo ya hecho (empresa creada y factura subida)', async () => {
  const clientify = clientifyFalso();
  const r = await sincronizarEmpresa({ ...EMPRESA, clientify_company_id: '300', factura_subida: true },
    { clientify, entorno: 'preview', enlaceFactura });
  assert.equal(r.contactId, '400');
  assert.deepEqual(clientify.llamadas, ['buscarContacto', 'crearContacto']);
});

test('si falla un paso, el error lleva lo ya creado para no duplicarlo', async () => {
  const clientify = clientifyFalso({ fallos: { crearContacto: new ErrorClientify('503', { status: 503 }) } });
  await assert.rejects(sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', enlaceFactura }),
    (e) => e.reintentable && e.parcial.companyId === '300' && e.parcial.facturaSubida === false && e.parcial.contactId === null);
});

test('si la factura falla (p. ej. 403), el contacto ya quedó creado y el reintento solo repite la factura', async () => {
  const clientify = clientifyFalso({ fallos: { subirFactura: new ErrorClientify('Clientify respondió 403', { status: 403, reintentable: false }) } });
  await assert.rejects(sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', enlaceFactura }),
    (e) => e.status === 403 && e.parcial.companyId === '300' && e.parcial.contactId === '400' && e.parcial.facturaSubida === false);
  assert.deepEqual(clientify.llamadas, ['buscarEmpresa', 'crearEmpresa', 'buscarContacto', 'crearContacto', 'obtenerEmpresa', 'subirFactura']);
  const otra = clientifyFalso();
  const r = await sincronizarEmpresa({ ...EMPRESA, clientify_company_id: '300', clientify_contact_id: '400' }, { clientify: otra, entorno: 'preview', enlaceFactura });
  assert.deepEqual(r, { companyId: '300', contactId: '400', facturaSubida: true });
  assert.deepEqual(otra.llamadas, ['obtenerEmpresa', 'subirFactura']);
});

test('contacto existente sin aliado: se vincula a la empresa y recibe ID_aliado y etiquetas', async () => {
  const clientify = clientifyFalso({ contactoExistente: { id: 77, email: EMPRESA.correo, custom_fields: [] } });
  const r = await sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', enlaceFactura });
  assert.equal(r.contactId, '77');
  assert.ok(!clientify.llamadas.includes('crearContacto'));
  assert.ok(clientify.llamadas.includes('actualizarContacto') && clientify.llamadas.includes('etiqueta:Referido perfecto'));
});

test('contacto existente de OTRO aliado: no se cambia la atribución, queda para revisión', async () => {
  const clientify = clientifyFalso({ contactoExistente: { id: 77, email: EMPRESA.correo, custom_fields: [{ field: 'ID_aliado', value: 'LKOTRO2345678' }] } });
  await assert.rejects(sincronizarEmpresa(EMPRESA, { clientify, entorno: 'preview', enlaceFactura }),
    (e) => !e.reintentable && /otro ID_aliado/.test(e.message) && !clientify.llamadas.includes('actualizarContacto'));
});

test('fuera de Production, un contacto sin +prueba no se envía a Clientify', async () => {
  const clientify = clientifyFalso();
  await assert.rejects(sincronizarEmpresa({ ...EMPRESA, correo: 'real@cliente.com' }, { clientify, entorno: 'preview', enlaceFactura }),
    (e) => !e.reintentable);
  assert.equal(clientify.llamadas.length, 0);
});

test('cliente HTTP: busca empresa por nombre exacto y actualiza la empresa con PATCH', async () => {
  const pedidas = [];
  const respuestas = [
    { status: 200, body: { count: 2, results: [{ id: 1, name: 'Industrias Sol S.A.S.' }, { id: 2, name: 'INDUSTRIAS SOL' }] } },
    { status: 200, body: { id: 2 } }
  ];
  const fetchFalso = async (url, opciones) => {
    pedidas.push({ url, opciones });
    const r = respuestas.shift();
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  const cliente = crearClienteClientify({ apiKey: 'clave', urlBase: 'https://clientify.test/v1', fetchImpl: fetchFalso });
  assert.equal((await cliente.buscarEmpresaPorNombre('Industrias Sol')).id, 2, 'ignora nombres parecidos');
  await cliente.actualizarEmpresa(2, { description: 'x' });
  assert.equal(pedidas[1].url, 'https://clientify.test/v1/companies/2/');
  assert.equal(pedidas[1].opciones.method, 'PATCH');
  assert.equal(pedidas[1].opciones.body, JSON.stringify({ description: 'x' }));
});

test('enlace de la factura: URL firmada de descarga del bucket privado, válida 180 días', async () => {
  const { enlazadorDeFacturas } = await import('../../lib/clientify/cola.js');
  let pedido;
  const supabase = { storage: { from: (b) => ({ createSignedUrl: async (ruta, segundos, opciones) => {
    pedido = { b, ruta, segundos, opciones }; return { data: { signedUrl: 'https://s.test/firmado' }, error: null }; } }) } };
  assert.equal(await enlazadorDeFacturas(supabase)('a/e/factura.pdf', 'factura.pdf'), 'https://s.test/firmado');
  assert.deepEqual(pedido, { b: 'facturas', ruta: 'a/e/factura.pdf', segundos: 180 * 86400, opciones: { download: 'factura.pdf' } });
});
