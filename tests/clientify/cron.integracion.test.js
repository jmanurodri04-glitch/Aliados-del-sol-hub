// Prueba de integración del endpoint /api/cron/clientify-aliados con una base Supabase local
// (`npx supabase start`) y un Clientify simulado por HTTP. Se omite si no hay base local.
//
//   PRUEBAS_SUPABASE_URL=http://127.0.0.1:54321 PRUEBAS_SUPABASE_SECRET_KEY=<secret local> \
//   PRUEBAS_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const { PRUEBAS_SUPABASE_URL, PRUEBAS_SUPABASE_SECRET_KEY, PRUEBAS_DB_URL } = process.env;
const omitir = !(PRUEBAS_SUPABASE_URL && PRUEBAS_SUPABASE_SECRET_KEY && PRUEBAS_DB_URL)
  && 'requiere una base Supabase local (ver el encabezado del archivo)';

const sql = (consulta) => execFileSync('psql', [PRUEBAS_DB_URL, '-AtqX', '-c', consulta]).toString().trim();

const ALIADOS = {
  nuevo:     { id: 'c1000000-0000-0000-0000-000000000001', correo: 'nuevo+prueba@cron.test', tipo: 'emi', estado: 'activo' },
  existente: { id: 'c2000000-0000-0000-0000-000000000002', correo: 'existente+prueba@cron.test', tipo: 'cliente_embajador', estado: 'activo' },
  falla:     { id: 'c3000000-0000-0000-0000-000000000003', correo: 'falla+prueba@cron.test', tipo: 'financiero', estado: 'activo' },
  real:      { id: 'c4000000-0000-0000-0000-000000000004', correo: 'real@cron.test', tipo: 'linker', estado: 'activo' },
  pendiente: { id: 'c5000000-0000-0000-0000-000000000005', correo: 'pendiente+prueba@cron.test', tipo: 'emi', estado: 'pendiente' }
};

let servidor;
const pedidas = [];

// Clientify simulado: registra cada solicitud y responde como la API real.
function iniciarClientifyFalso() {
  return new Promise((resolver) => {
    servidor = http.createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (c) => { cuerpo += c; });
      req.on('end', () => {
        const pedida = { metodo: req.method, url: req.url, auth: req.headers.authorization, cuerpo: cuerpo ? JSON.parse(cuerpo) : null };
        pedidas.push(pedida);
        const json = (status, datos) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
        if (req.method === 'GET' && req.url.startsWith('/v1/contacts/?email=')) {
          const correo = decodeURIComponent(req.url.split('=')[1]);
          return json(200, { count: 1, results: correo === ALIADOS.existente.correo ? [{ id: 4242, emails: [{ email: correo }] }] : [] });
        }
        if (req.method === 'POST' && req.url === '/v1/contacts/') {
          if (pedida.cuerpo.email === ALIADOS.falla.correo) return json(503, { detail: 'Servicio no disponible' });
          return json(201, { id: 1001, ...pedida.cuerpo });
        }
        if (req.method === 'PATCH' && /^\/v1\/contacts\/\d+\/$/.test(req.url)) return json(200, { id: 1 });
        if (req.method === 'POST' && /^\/v1\/contacts\/\d+\/tags\/$/.test(req.url)) return json(201, { name: pedida.cuerpo.name });
        return json(404, { detail: 'No encontrado' });
      });
    }).listen(0, '127.0.0.1', () => resolver(servidor.address().port));
  });
}

async function llamarEndpoint(autorizacion) {
  const { default: handler } = await import('../../api/cron/clientify-aliados.js');
  return new Promise((resolver) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(d) { resolver({ status: this.statusCode, cuerpo: d }); }
    };
    handler({ method: 'GET', headers: autorizacion ? { authorization: autorizacion } : {} }, res);
  });
}

before(async () => {
  if (omitir) return;
  const puerto = await iniciarClientifyFalso();
  Object.assign(process.env, {
    SUPABASE_URL: PRUEBAS_SUPABASE_URL,
    SUPABASE_SECRET_KEY: PRUEBAS_SUPABASE_SECRET_KEY,
    CLIENTIFY_API_KEY: 'clave-de-prueba',
    CLIENTIFY_API_URL: `http://127.0.0.1:${puerto}/v1`,
    CRON_SECRET: 'secreto-cron-de-prueba',
    VERCEL_ENV: 'preview'
  });
  sql("delete from auth.users where email like '%@cron.test'");
  for (const [nombre, a] of Object.entries(ALIADOS)) {
    const meta = JSON.stringify({
      nombre_completo: 'Prueba ' + nombre, celular: '+573001234567', tipo_aliado: a.tipo,
      organizacion: 'Banco X', cargo: 'Gerente', como_llega_empresas: 'Red', autorizacion_datos: true, acepta_terminos: true
    });
    sql(`insert into auth.users (id, email, raw_user_meta_data) values ('${a.id}', '${a.correo}', '${meta}'::jsonb)`);
    if (a.estado === 'activo') sql(`update public.aliados set estado = 'activo', aprobado_at = now() where id = '${a.id}'`);
  }
});

after(() => {
  if (omitir) return;
  sql("delete from auth.users where email like '%@cron.test'");
  servidor.close();
});

const fila = (a, columnas) => sql(`select ${columnas} from public.aliados where id = '${a.id}'`);
const codigo = (a) => fila(a, 'codigo_aliado');

test('sin el secreto del cron responde 401 y no toca nada', { skip: omitir }, async () => {
  assert.equal((await llamarEndpoint()).status, 401);
  assert.equal((await llamarEndpoint('Bearer otro')).status, 401);
  assert.equal(pedidas.length, 0);
});

test('procesa la cola: crea, vincula, registra errores y respeta las reglas del entorno de pruebas', { skip: omitir }, async () => {
  const { status, cuerpo } = await llamarEndpoint('Bearer secreto-cron-de-prueba');
  assert.equal(status, 200);
  assert.equal(cuerpo.entorno, 'preview');
  assert.equal(cuerpo.procesados, 4, 'los 4 activos; el pendiente de aprobación no se procesa');
  assert.equal(cuerpo.ok, 2);
  assert.equal(cuerpo.errores, 2);

  // Nuevo: contacto creado con etiquetas (incluida PRUEBA HUB) e ID_aliado.
  const creacion = pedidas.find((p) => p.metodo === 'POST' && p.url === '/v1/contacts/' && p.cuerpo.email === ALIADOS.nuevo.correo);
  assert.deepEqual(creacion.cuerpo.tags, ['Aliado del Sol', 'AdS EMI', 'PRUEBA HUB']);
  assert.deepEqual(creacion.cuerpo.custom_fields, [{ field: 'ID_aliado', value: codigo(ALIADOS.nuevo) }]);
  assert.equal(creacion.auth, 'Token clave-de-prueba');
  assert.equal(fila(ALIADOS.nuevo, "clientify_sync_estado || '|' || clientify_contact_id"), 'ok|1001');

  // Existente: se vincula sin crear otro contacto ni pisar sus datos.
  assert.ok(!pedidas.some((p) => p.metodo === 'POST' && p.url === '/v1/contacts/' && p.cuerpo.email === ALIADOS.existente.correo));
  const vinculo = pedidas.find((p) => p.metodo === 'PATCH' && p.url === '/v1/contacts/4242/');
  assert.deepEqual(vinculo.cuerpo, { custom_fields: [{ field: 'ID_aliado', value: codigo(ALIADOS.existente) }] });
  assert.deepEqual(pedidas.filter((p) => p.url === '/v1/contacts/4242/tags/').map((p) => p.cuerpo.name),
    ['Aliado del Sol', 'AdS Cliente Embajador', 'PRUEBA HUB']);
  assert.equal(fila(ALIADOS.existente, "clientify_sync_estado || '|' || clientify_contact_id"), 'ok|4242');

  // Falla de Clientify: queda en error con reintento programado.
  assert.match(fila(ALIADOS.falla, "clientify_sync_estado || '|' || clientify_sync_intentos || '|' || clientify_sync_error"), /^error\|1\|Clientify respondió 503/);

  // Correo real en Preview: no se envía nada a Clientify.
  assert.ok(!pedidas.some((p) => JSON.stringify(p).includes(ALIADOS.real.correo)));
  assert.match(fila(ALIADOS.real, 'clientify_sync_error'), /solo se sincronizan correos que contengan "\+prueba"/);

  // Pendiente de aprobación: intacto. Y nunca viaja un id interno.
  assert.equal(fila(ALIADOS.pendiente, 'clientify_sync_estado'), 'pendiente');
  assert.ok(!pedidas.some((p) => Object.values(ALIADOS).some((a) => JSON.stringify(p).includes(a.id))));
});

test('una segunda ejecución no repite lo sincronizado ni reintenta antes de tiempo', { skip: omitir }, async () => {
  const antes = pedidas.length;
  const { cuerpo } = await llamarEndpoint('Bearer secreto-cron-de-prueba');
  assert.equal(cuerpo.procesados, 0);
  assert.equal(pedidas.length, antes);
});

test('si el aliado edita su perfil, se actualiza el mismo contacto', { skip: omitir }, async () => {
  sql(`update public.aliados set celular = '+573115550000' where id = '${ALIADOS.nuevo.id}'`);
  const { cuerpo } = await llamarEndpoint('Bearer secreto-cron-de-prueba');
  assert.deepEqual(cuerpo.detalle, [{ codigo_aliado: codigo(ALIADOS.nuevo), accion: 'actualizado' }]);
  const actualizacion = pedidas.findLast((p) => p.metodo === 'PATCH' && p.url === '/v1/contacts/1001/');
  assert.equal(actualizacion.cuerpo.phone, '+573115550000');
  assert.equal(fila(ALIADOS.nuevo, 'clientify_sync_estado'), 'ok');
});
