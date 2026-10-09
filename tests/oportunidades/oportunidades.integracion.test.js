// Prueba de integración de "Nueva oportunidad" (CLAUDE.md §7.2 y §8 flujo B): /api/oportunidades/factura,
// subida directa a Storage con la URL firmada y /api/oportunidades, contra una base Supabase local
// (`npx supabase start`) y un Clientify simulado por HTTP. Se omite si no hay base local.
//
//   PRUEBAS_SUPABASE_URL=http://127.0.0.1:54321 PRUEBAS_SUPABASE_SECRET_KEY=<secret local> \
//   PRUEBAS_SUPABASE_PUBLISHABLE_KEY=<publishable local> \
//   PRUEBAS_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const { PRUEBAS_SUPABASE_URL, PRUEBAS_SUPABASE_SECRET_KEY, PRUEBAS_SUPABASE_PUBLISHABLE_KEY, PRUEBAS_DB_URL } = process.env;
const omitir = !(PRUEBAS_SUPABASE_URL && PRUEBAS_SUPABASE_SECRET_KEY && PRUEBAS_SUPABASE_PUBLISHABLE_KEY && PRUEBAS_DB_URL)
  && 'requiere una base Supabase local (ver el encabezado del archivo)';

const sql = (consulta) => execFileSync('psql', [PRUEBAS_DB_URL, '-AtqX', '-c', consulta]).toString().trim();
const CLAVE = 'Clave-de-prueba-123';
const PDF = Buffer.from('%PDF-1.4\n% factura de prueba\n');

const ALIADOS = {
  activo:    { correo: 'activo+prueba@oportunidades.test', estado: 'activo' },
  otro:      { correo: 'otro+prueba@oportunidades.test', estado: 'activo' },
  pendiente: { correo: 'pendiente+prueba@oportunidades.test', estado: 'pendiente' }
};

const REFERIDO = {
  empresa: 'Industrias Sol Prueba', sector: 'Industrial', subsector: 'Manufactura', ciudad: 'Bucaramanga',
  nombre_contacto: 'Laura Gómez', cargo: 'Gerente', telefono: '+573105551234', correo: 'laura+prueba@cliente.test',
  valor_factura: 4500000, observaciones: 'Cubierta propia', autorizacion_contacto: true
};

let servidor;
const pedidas = [];
let siguienteId = 500;

// Clientify simulado: registra cada solicitud y responde como la API real.
function iniciarClientifyFalso() {
  return new Promise((resolver) => {
    servidor = http.createServer((req, res) => {
      const partes = [];
      req.on('data', (c) => partes.push(c));
      req.on('end', () => {
        const crudo = Buffer.concat(partes);
        const multipart = String(req.headers['content-type'] || '').startsWith('multipart/form-data');
        const pedida = { metodo: req.method, url: req.url, auth: req.headers.authorization, multipart,
          cuerpo: multipart ? crudo.toString('latin1') : (crudo.length ? JSON.parse(crudo) : null) };
        pedidas.push(pedida);
        const json = (status, datos) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
        const puerto = servidor.address().port;
        if (req.method === 'GET' && req.url.startsWith('/v1/companies/?name=')) return json(200, { count: 0, results: [] });
        if (req.method === 'POST' && req.url === '/v1/companies/') {
          const id = siguienteId++;
          return json(201, { id, url: `http://127.0.0.1:${puerto}/v1/companies/${id}/`, ...pedida.cuerpo });
        }
        if (req.method === 'POST' && /^\/v1\/companies\/\d+\/files\/$/.test(req.url)) return json(201, { id: 1 });
        if (req.method === 'GET' && req.url.startsWith('/v1/contacts/?email=')) return json(200, { count: 0, results: [] });
        if (req.method === 'POST' && req.url === '/v1/contacts/') return json(201, { id: siguienteId++, ...pedida.cuerpo });
        return json(404, { detail: 'No encontrado' });
      });
    }).listen(0, '127.0.0.1', () => resolver(servidor.address().port));
  });
}

async function llamar(ruta, { token, cuerpo }) {
  const { default: handler } = await import(`../../api/oportunidades/${ruta}.js`);
  return new Promise((resolver) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(d) { resolver({ status: this.statusCode, cuerpo: d }); }
    };
    handler({ method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body: cuerpo || {} }, res);
  });
}

const publico = () => createClient(PRUEBAS_SUPABASE_URL, PRUEBAS_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const admin = () => createClient(PRUEBAS_SUPABASE_URL, PRUEBAS_SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

/** Lo mismo que hace el navegador: pide la URL firmada y sube el archivo directo a Storage. */
async function subirFactura(a, { contenido = PDF, tipo = 'application/pdf', nombre = 'Factura Energía.pdf' } = {}) {
  const r = await llamar('factura', { token: a.token, cuerpo: { nombre_archivo: nombre, tipo, tamano: contenido.length } });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
  const { error } = await publico().storage.from('facturas').uploadToSignedUrl(r.cuerpo.ruta, r.cuerpo.token, contenido, { contentType: tipo });
  assert.equal(error, null);
  return r.cuerpo;
}

// Storage no permite borrar sus tablas por SQL: las facturas de prueba se borran con su API.
async function limpiar() {
  const rutas = sql(`select o.name from storage.objects o join auth.users u on o.name like u.id || '/%'
    where o.bucket_id = 'facturas' and u.email like '%@oportunidades.test'`).split('\n').filter(Boolean);
  if (rutas.length) await admin().storage.from('facturas').remove(rutas);
  sql("delete from auth.users where email like '%@oportunidades.test'");
}

const existeArchivo = (ruta) => sql(`select count(*) from storage.objects where bucket_id = 'facturas' and name = '${ruta}'`) === '1';

before(async () => {
  if (omitir) return;
  const puerto = await iniciarClientifyFalso();
  Object.assign(process.env, {
    SUPABASE_URL: PRUEBAS_SUPABASE_URL,
    SUPABASE_SECRET_KEY: PRUEBAS_SUPABASE_SECRET_KEY,
    CLIENTIFY_API_KEY: 'clave-de-prueba',
    CLIENTIFY_API_URL: `http://127.0.0.1:${puerto}/v1`,
    VERCEL_ENV: 'preview'
  });
  await limpiar();
  // El celular es único por aliado (migración celular_unico): cada uno lleva el suyo.
  for (const [i, [nombre, a]] of Object.entries(ALIADOS).entries()) {
    const { data, error } = await admin().auth.admin.createUser({
      email: a.correo, password: CLAVE, email_confirm: true,
      user_metadata: { nombre_completo: 'Prueba ' + nombre, celular: '+57300123' + String(4000 + i), tipo_aliado: 'emi',
        como_llega_empresas: 'Red', autorizacion_datos: true, acepta_terminos: true }
    });
    assert.equal(error, null);
    a.id = data.user.id;
    if (a.estado === 'activo') sql(`update public.aliados set estado = 'activo', aprobado_at = now() where id = '${a.id}'`);
    const { data: sesion } = await publico().auth.signInWithPassword({ email: a.correo, password: CLAVE });
    a.token = sesion.session.access_token;
  }
});

after(async () => {
  if (omitir) return;
  await limpiar();
  servidor.close();
});

test('sin sesión responde 401 y una cuenta pendiente de aprobación responde 403', { skip: omitir }, async () => {
  assert.equal((await llamar('factura', {})).status, 401);
  assert.equal((await llamar('index', { cuerpo: { datos: REFERIDO } })).status, 401);
  assert.equal((await llamar('index', { token: 'token-falso', cuerpo: {} })).status, 401);
  assert.equal((await llamar('factura', { token: ALIADOS.pendiente.token, cuerpo: { tipo: 'application/pdf', tamano: 10 } })).status, 403);
  const r = await llamar('index', { token: ALIADOS.pendiente.token, cuerpo: { empresa_id: crypto.randomUUID(), datos: REFERIDO } });
  assert.equal(r.status, 403);
});

test('la factura solo acepta PDF, JPG o PNG de máximo 10 MB', { skip: omitir }, async () => {
  const token = ALIADOS.activo.token;
  assert.equal((await llamar('factura', { token, cuerpo: { nombre_archivo: 'x.docx', tipo: 'application/msword', tamano: 10 } })).status, 422);
  assert.equal((await llamar('factura', { token, cuerpo: { nombre_archivo: 'x.pdf', tipo: 'application/pdf', tamano: 11 * 1024 * 1024 } })).status, 422);
});

test('referido perfecto con factura: puntos, empresa y factura en Clientify y contacto vinculado', { skip: omitir }, async () => {
  const a = ALIADOS.activo;
  const factura = await subirFactura(a);
  assert.ok(factura.ruta.startsWith(`${a.id}/${factura.empresa_id}/`));
  assert.match(factura.ruta, /\/Factura-Energia\.pdf$/);

  const r = await llamar('index', { token: a.token, cuerpo: {
    empresa_id: factura.empresa_id, datos: REFERIDO, factura: { ruta: factura.ruta, nombre_archivo: 'Factura Energía.pdf' } } });
  assert.equal(r.status, 201, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.es_perfecto, true);
  assert.deepEqual(r.cuerpo.movimientos.map((m) => [m.motivo, m.puntos]), [['registro_valido', 10], ['referido_perfecto', 20]]);
  assert.equal(r.cuerpo.puntos_disponibles, 30);
  assert.equal(r.cuerpo.clientify, 'ok');

  // Clientify: empresa → factura adjunta a la empresa → contacto vinculado con ID_aliado y etiquetas.
  const codigo = sql(`select codigo_aliado from public.aliados where id = '${a.id}'`);
  const empresa = pedidas.find((p) => p.metodo === 'POST' && p.url === '/v1/companies/');
  assert.equal(empresa.cuerpo.name, REFERIDO.empresa);
  const archivo = pedidas.find((p) => p.url === `/v1/companies/${500}/files/`);
  assert.ok(archivo && archivo.multipart && archivo.cuerpo.includes('%PDF-1.4') && archivo.cuerpo.includes('name="file"'));
  const contacto = pedidas.find((p) => p.metodo === 'POST' && p.url === '/v1/contacts/');
  assert.equal(contacto.cuerpo.email, REFERIDO.correo);
  assert.match(contacto.cuerpo.company, /\/v1\/companies\/500\/$/);
  assert.deepEqual(contacto.cuerpo.tags, ['Referido perfecto', 'PRUEBA HUB']);
  assert.deepEqual(contacto.cuerpo.custom_fields, [{ field: 'ID_aliado', value: codigo }]);
  assert.equal(contacto.auth, 'Token clave-de-prueba');
  assert.ok(!pedidas.some((p) => JSON.stringify(p).includes(a.id) || JSON.stringify(p).includes(factura.empresa_id)),
    'nunca viajan ids internos a Clientify');

  // Base: empresa sincronizada, factura marcada como subida y avance inicial.
  assert.equal(sql(`select origen || '|' || es_perfecto || '|' || clientify_sync_estado || '|' || clientify_company_id || '|' || clientify_contact_id
    from public.empresas where id = '${factura.empresa_id}'`), 'hub|true|ok|500|501');
  assert.equal(sql(`select (clientify_subida_at is not null) || '|' || storage_path from public.facturas where empresa_id = '${factura.empresa_id}'`),
    `true|${factura.ruta}`);
  assert.equal(sql(`select perfecto from public.avance_empresa where empresa_id = '${factura.empresa_id}'`), 'si');
});

test('un contacto ya referido se rechaza (409) y se borra la factura subida', { skip: omitir }, async () => {
  const a = ALIADOS.otro;
  const factura = await subirFactura(a);
  assert.ok(existeArchivo(factura.ruta));
  const r = await llamar('index', { token: a.token, cuerpo: {
    empresa_id: factura.empresa_id, datos: { ...REFERIDO, correo: REFERIDO.correo.toUpperCase() }, factura: { ruta: factura.ruta } } });
  assert.equal(r.status, 409);
  assert.ok(!existeArchivo(factura.ruta), 'la factura huérfana se borra');
});

test('no se puede usar ni borrar la factura de otro aliado', { skip: omitir }, async () => {
  const ajena = await subirFactura(ALIADOS.activo, { nombre: 'ajena.pdf' });
  const r = await llamar('index', { token: ALIADOS.otro.token, cuerpo: {
    empresa_id: ajena.empresa_id, datos: { ...REFERIDO, correo: 'nuevo+prueba@cliente.test' }, factura: { ruta: ajena.ruta } } });
  assert.equal(r.status, 422);
  assert.ok(existeArchivo(ajena.ruta), 'el archivo del otro aliado sigue intacto');
});

test('un aliado no puede referirse a sí mismo', { skip: omitir }, async () => {
  const r = await llamar('index', { token: ALIADOS.otro.token, cuerpo: {
    empresa_id: crypto.randomUUID(), datos: { ...REFERIDO, correo: ALIADOS.otro.correo, telefono: '+573009998877' } } });
  assert.equal(r.status, 422);
  assert.match(r.cuerpo.error, /ti mismo/);
});

test('sin la declaración de autorización del contacto no se registra', { skip: omitir }, async () => {
  const r = await llamar('index', { token: ALIADOS.otro.token, cuerpo: {
    empresa_id: crypto.randomUUID(), datos: { ...REFERIDO, correo: 'sinautorizacion+prueba@cliente.test', autorizacion_contacto: false } } });
  assert.equal(r.status, 422);
  assert.match(r.cuerpo.error, /autorización del contacto/);
});

test('referido imperfecto sin factura; en Preview un correo real queda sin enviar a Clientify', { skip: omitir }, async () => {
  const antes = pedidas.length;
  const empresaId = crypto.randomUUID();
  const r = await llamar('index', { token: ALIADOS.otro.token, cuerpo: {
    empresa_id: empresaId, datos: { empresa: 'Real SAS', sector: 'Comercial', nombre_contacto: 'Pedro Real',
      telefono: '+573204445566', correo: 'pedro@real.test', valor_factura: 800000, autorizacion_contacto: true } } });
  assert.equal(r.status, 201, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.es_perfecto, false);
  assert.deepEqual(r.cuerpo.movimientos.map((m) => [m.motivo, m.puntos]), [['registro_valido', 10], ['referido_imperfecto', 5]]);
  assert.equal(r.cuerpo.puntos_disponibles, 5);
  assert.equal(r.cuerpo.clientify, 'pendiente');
  assert.equal(pedidas.length, antes, 'no se llamó a Clientify');
  assert.match(sql(`select clientify_sync_estado || '|' || clientify_sync_error from public.empresas where id = '${empresaId}'`),
    /^error\|.*\+prueba/);
});
