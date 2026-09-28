// Prueba de integración del flujo C: POST /api/webhooks/clientify → cola → /api/cron/clientify (vuelve a
// consultar un Clientify simulado) → avance y puntos en una base Supabase local. También la conciliación y el
// diagnóstico. Se omite si no hay base local.
//
//   PRUEBAS_SUPABASE_URL=http://127.0.0.1:54321 PRUEBAS_SUPABASE_SECRET_KEY=<secret local> \
//   PRUEBAS_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { FASES_CLIENTIFY, oportunidadEnFase } from '../clientify/fases.fixture.js';

const { PRUEBAS_SUPABASE_URL, PRUEBAS_SUPABASE_SECRET_KEY, PRUEBAS_DB_URL } = process.env;
const omitir = !(PRUEBAS_SUPABASE_URL && PRUEBAS_SUPABASE_SECRET_KEY && PRUEBAS_DB_URL)
  && 'requiere una base Supabase local (ver el encabezado del archivo)';

const sql = (consulta) => execFileSync('psql', [PRUEBAS_DB_URL, '-AtqX', '-c', consulta]).toString().trim();
const ALIADO = { id: 'f6000000-0000-0000-0000-0000000000f6', correo: 'aliado+prueba@webhook.test' };
const TOKEN = 'token-webhook-de-prueba';
const CRON = 'Bearer secreto-cron-webhook';

// Estado de Clientify simulado (se modifica en cada prueba).
const clientify = { contactos: {}, oportunidades: {}, fallar: new Set() };
const pedidas = [];
let servidor;

function iniciarClientifyFalso() {
  return new Promise((resolver) => {
    servidor = http.createServer((req, res) => {
      pedidas.push({ metodo: req.method, url: req.url });
      const json = (status, datos) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
      const url = new URL(req.url, 'http://x');
      let m;
      if ((m = url.pathname.match(/^\/v1\/contacts\/(\d+)\/$/))) {
        if (clientify.fallar.has(m[1])) return json(503, { detail: 'No disponible' });
        return clientify.contactos[m[1]] ? json(200, clientify.contactos[m[1]]) : json(404, { detail: 'No encontrado' });
      }
      if ((m = url.pathname.match(/^\/v1\/deals\/(\d+)\/$/))) {
        return clientify.oportunidades[m[1]] ? json(200, clientify.oportunidades[m[1]]) : json(404, { detail: 'No encontrado' });
      }
      if (url.pathname === '/v1/deals/pipelines/stages/') return json(200, { count: FASES_CLIENTIFY.length, next: null, results: FASES_CLIENTIFY });
      if (url.pathname === '/v1/deals/') {
        // Como la API real: ignora ?contact= y pagina de a `page_size`.
        const todas = Object.values(clientify.oportunidades);
        const tam = Number(url.searchParams.get('page_size') || 100);
        const pagina = Number(url.searchParams.get('page') || 1);
        const next = pagina * tam < todas.length ? `http://127.0.0.1:${servidor.address().port}/v1/deals/?page=${pagina + 1}&page_size=${tam}` : null;
        return json(200, { count: todas.length, next, results: todas.slice((pagina - 1) * tam, pagina * tam) });
      }
      if (url.pathname === '/v1/contacts/') {
        const lista = Object.values(clientify.contactos);
        return json(200, { count: lista.length, next: null, results: lista });
      }
      if (url.pathname === '/v1/custom-fields/') return json(200, { count: 1, results: [{ id: 1, name: 'ID_aliado', content_type: 'contact' }] });
      if (url.pathname === '/v1/contacts/tags/') return json(200, { count: 1, results: [{ id: 1, name: 'Referido perfecto' }] });
      return json(404, { detail: 'No encontrado' });
    }).listen(0, '127.0.0.1', () => resolver(servidor.address().port));
  });
}

function respuesta(resolver) {
  return {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { resolver({ status: this.statusCode, cuerpo: d }); }
  };
}
async function webhook(cuerpo, { token = TOKEN, metodo = 'POST' } = {}) {
  const { default: handler } = await import('../../api/webhooks/clientify.js');
  return new Promise((r) => handler({ method: metodo, query: token ? { token } : {}, headers: {}, body: cuerpo }, respuesta(r)));
}
async function cron(ruta = 'clientify') {
  const { default: handler } = await import(`../../api/cron/${ruta}.js`);
  return new Promise((r) => handler({ method: 'GET', headers: { authorization: CRON } }, respuesta(r)));
}
const ahora = () => sql('update public.clientify_cola_entidades set programado_at = now()'); // salta la espera de 2 minutos

let codigo;
const contacto = (id, extra = {}) => ({
  id, first_name: 'Contacto', last_name: String(id), emails: [{ email: `c${id}+prueba@lead.test` }], phones: [{ phone: '+573105550000' }],
  company_name: 'Empresa ' + id, status: 'cold-lead', tags: ['referido perfecto'],
  custom_fields: [{ field: 'ID_aliado', value: codigo }], ...extra
});
// Oportunidad en una fase real del catálogo de Clientify (embudo AUTOCONSUMO salvo que se indique otro).
const oportunidad = (id, contacto, fase, monto, { embudo = 'GEENERA AUTOCONSUMO', ...extra } = {}) =>
  oportunidadEnFase(embudo, fase, { id, contact: `https://api.clientify.net/v1/contacts/${contacto}/`, amount: `${monto}.00`, ...extra });
const empresa = (contactId, columnas) => sql(`select ${columnas} from public.empresas e join public.avance_empresa a on a.empresa_id = e.id
  where e.clientify_contact_id = '${contactId}'`);
const motivos = (contactId) => sql(`select string_agg(m.motivo, ',' order by m.secuencia) from public.movimientos_puntos m
  join public.empresas e on m.vinculo_id = e.id::text where e.clientify_contact_id = '${contactId}'`);
const limpiar = () => {
  sql("delete from public.clientify_cola_entidades");
  sql("delete from public.webhook_eventos where entidad_id like '5%' or entidad_id like '6%'");
  sql("delete from auth.users where email like '%@webhook.test'");
};

before(async () => {
  if (omitir) return;
  const puerto = await iniciarClientifyFalso();
  Object.assign(process.env, {
    SUPABASE_URL: PRUEBAS_SUPABASE_URL, SUPABASE_SECRET_KEY: PRUEBAS_SUPABASE_SECRET_KEY,
    CLIENTIFY_API_KEY: 'clave-de-prueba', CLIENTIFY_API_URL: `http://127.0.0.1:${puerto}/v1`,
    CRON_SECRET: 'secreto-cron-webhook', CLIENTIFY_WEBHOOK_SECRET: TOKEN, VERCEL_ENV: 'preview'
  });
  limpiar();
  const meta = JSON.stringify({ nombre_completo: 'Aliado Webhook', celular: '+573009990001', tipo_aliado: 'linker',
    como_llega_empresas: 'Red', autorizacion_datos: true, acepta_terminos: true });
  sql(`insert into auth.users (id, email, raw_user_meta_data) values ('${ALIADO.id}', '${ALIADO.correo}', '${meta}'::jsonb)`);
  // Activo y ya sincronizado (el flujo A no interviene en esta prueba).
  sql(`update public.aliados set estado = 'activo', aprobado_at = now(), clientify_sync_estado = 'ok', clientify_contact_id = '4999' where id = '${ALIADO.id}'`);
  codigo = sql(`select codigo_aliado from public.aliados where id = '${ALIADO.id}'`);
});

after(() => {
  if (omitir) return;
  limpiar();
  servidor.close();
});

test('el webhook exige el token y responde enseguida', { skip: omitir }, async () => {
  assert.equal((await webhook({ data: { id: 1 } }, { token: null })).status, 401);
  assert.equal((await webhook({ data: { id: 1 } }, { token: 'otro' })).status, 401);
  assert.equal((await webhook(null, { metodo: 'GET' })).status, 200, 'verificación de la URL');
  const { default: handler } = await import('../../api/webhooks/clientify.js');
  const conEncabezado = await new Promise((r) => handler({ method: 'GET', query: {}, headers: { 'x-webhook-token': TOKEN } }, respuesta(r)));
  assert.equal(conEncabezado.status, 200, 'el token también se acepta en el encabezado x-webhook-token (n8n)');
  assert.equal(pedidas.length, 0, 'recibir un evento no llama a Clientify');
});

test('lead nuevo del formulario público: se crea la empresa con +10 y +20', { skip: omitir }, async () => {
  clientify.contactos['5001'] = contacto('5001');
  const r = await webhook({ hook: { event: 'contact.created' }, data: { id: 5001 } });
  assert.equal(r.status, 200);
  assert.equal(sql("select count(*) from public.clientify_cola_entidades where entidad_id = '5001' and programado_at > now() + interval '100 seconds'"), '1',
    'un contacto nuevo espera ~2 minutos');

  assert.equal((await cron()).cuerpo.entidades.procesados, 0, 'antes de los 2 minutos no se procesa');
  ahora();
  const { status, cuerpo } = await cron();
  assert.equal(status, 200);
  assert.deepEqual(cuerpo.entidades.detalle, [{ entidad: 'contacto', id: '5001', resultado: 'actualizado', movimientos: ['referido_perfecto'] }]);
  assert.equal(empresa('5001', "e.origen || '|' || e.aliado_id || '|' || a.perfecto || '|' || a.calificado || '|' || a.estado_contacto_clientify"),
    `clientify_form|${ALIADO.id}|si|revision|cold-lead`);
  assert.equal(motivos('5001'), 'registro_valido,referido_perfecto');
  assert.equal(sql("select count(*) from public.webhook_eventos where entidad_id = '5001' and procesado_at is not null and error is null"), '1');
  assert.ok(pedidas.some((p) => p.url === '/v1/contacts/5001/'), 'vuelve a consultar el contacto');
  assert.ok(!pedidas.some((p) => p.url.startsWith('/v1/deals/?')), 'no depende del filtro ?contact= (la API no lo aplica)');
});

test('la oportunidad avanza de golpe a la fase 6: calificado, evaluación técnica y propuesta', { skip: omitir }, async () => {
  clientify.contactos['5001'].status = 'in-deal';
  clientify.oportunidades['6001'] = oportunidad(6001, 5001, '2. Agendamiento Visita Tecnica', 50000000);
  clientify.oportunidades['6002'] = oportunidad(6002, 5001, '6. Presentación de Oferta', 180000000);
  clientify.oportunidades['6999'] = oportunidad(6999, 5999, '10. Contrato', 1, { status_desc: 'Won' });

  assert.equal((await webhook({ event: 'deal.updated', data: { id: 6002 } })).status, 200);
  const { cuerpo } = await cron();
  assert.deepEqual(cuerpo.entidades.detalle[0].movimientos, ['empresa_calificada', 'evaluacion_tecnica', 'propuesta_comercial']);
  assert.equal(motivos('5001'), 'registro_valido,referido_perfecto,empresa_calificada,evaluacion_tecnica,propuesta_comercial');
  assert.equal(empresa('5001', "e.clientify_deal_id || '|' || a.fase_oportunidad_num || '|' || a.negocio_cerrado || '|' || (a.fecha_calificado is not null) || '|' || coalesce(a.valor_cotizado::text, '-')"),
    '6002|6|revision|true|-', 'usa la oportunidad más avanzada del contacto; los valores los suma el escaneo');
  assert.equal(sql(`select puntos_disponibles from public.aliados where id = '${ALIADO.id}'`), '140');
});

test('eventos repetidos no generan puntos de nuevo', { skip: omitir }, async () => {
  await webhook({ event: 'deal.updated', data: { id: 6002 } });
  await webhook({ event: 'contact.updated', data: { id: 5001 } });
  const { cuerpo } = await cron();
  assert.equal(cuerpo.entidades.procesados, 2);
  assert.ok(cuerpo.entidades.detalle.every((d) => d.movimientos.length === 0));
  assert.equal(sql(`select puntos_disponibles from public.aliados where id = '${ALIADO.id}'`), '140');
});

test('un Status desconocido queda como aviso y no da puntos; un retroceso es un conflicto', { skip: omitir }, async () => {
  clientify.contactos['5001'].status = 'estado-nuevo';
  await webhook({ event: 'contact.updated', data: { id: 5001 } });
  await cron();
  assert.match(sql("select error from public.webhook_eventos where entidad_id = '5001' order by recibido_at desc limit 1"),
    /Status de contacto desconocido: "estado-nuevo"/);

  clientify.contactos['5001'].status = 'not-qualified-lead';
  await webhook({ event: 'contact.updated', data: { id: 5001 } });
  await cron();
  assert.match(sql("select error from public.webhook_eventos where entidad_id = '5001' order by recibido_at desc limit 1"),
    /Conflicto: Clientify cambió calificado de "si" a "no"/);
  assert.equal(empresa('5001', 'a.calificado'), 'si');
  assert.equal(sql(`select puntos_disponibles from public.aliados where id = '${ALIADO.id}'`), '140');
});

test('se ignoran el contacto del aliado, contactos sin +prueba en Preview y contactos ajenos al programa', { skip: omitir }, async () => {
  clientify.contactos['5002'] = contacto('5002', { emails: [{ email: 'real@lead.test' }] });
  clientify.contactos['4999'] = contacto('4999', { tags: ['aliados del sol', 'AdS Linker'] }); // el contacto del aliado (flujo A)
  clientify.contactos['5004'] = contacto('5004', { custom_fields: [] });
  for (const id of [5002, 4999, 5004]) await webhook({ event: 'contact.updated', data: { id } });
  const { cuerpo } = await cron();
  assert.deepEqual(cuerpo.entidades.detalle.map((d) => d.resultado), ['ignorado', 'ignorado', 'ignorado']);
  assert.equal(sql("select count(*) from public.empresas where clientify_contact_id in ('5002', '4999', '5004')"), '0');
  assert.match(sql("select error from public.webhook_eventos where entidad_id = '5002'"), /Entorno de pruebas/);
  assert.equal(sql("select count(*) from public.webhook_eventos where entidad_id in ('5002', '4999', '5004') and payload <> '{\"descartado\": true}'"), '0',
    'de lo ignorado no se guardan datos personales');
});

test('un referido del formulario con la etiqueta "aliado del sol hub" sí cuenta; el propio aliado no', { skip: omitir }, async () => {
  // El formulario público "Refiere tu negocio" pone esa etiqueta en el REFERIDO.
  clientify.contactos['5005'] = contacto('5005', { tags: ['aliado del sol hub', 'referido imperfecto'] });
  clientify.contactos['5006'] = contacto('5006', { emails: [{ email: ALIADO.correo }], tags: ['aliado del sol hub'] });
  for (const id of [5005, 5006]) await webhook({ hook: { event: 'contact.created' }, data: { id } });
  ahora();
  const { cuerpo } = await cron();
  assert.deepEqual(cuerpo.entidades.detalle.map((d) => [d.id, d.resultado]), [['5005', 'actualizado'], ['5006', 'rechazado']]);
  assert.equal(motivos('5005'), 'registro_valido,referido_imperfecto', '+10 por registro y −5 por la etiqueta de imperfecto');
  assert.match(sql("select error from public.webhook_eventos where entidad_id = '5006'"), /autorreferido/);
  assert.equal(sql("select count(*) from public.empresas where clientify_contact_id = '5006'"), '0');
});

test('si Clientify falla, el evento se reintenta más tarde', { skip: omitir }, async () => {
  clientify.fallar.add('5001');
  await webhook({ event: 'contact.updated', data: { id: 5001 } });
  const { cuerpo } = await cron();
  assert.equal(cuerpo.entidades.errores, 1);
  assert.equal(sql("select intentos || '|' || (programado_at > now()) from public.clientify_cola_entidades where entidad_id = '5001'"), '1|true');
  clientify.fallar.delete('5001');
});

test('la conciliación vuelve a encolar los referidos en curso', { skip: omitir }, async () => {
  sql('delete from public.clientify_cola_entidades');
  clientify.contactos['5001'].status = 'in-deal';
  const { status, cuerpo } = await cron('clientify-conciliacion');
  assert.equal(status, 200);
  assert.ok(cuerpo.encolados >= 1);
  assert.ok(cuerpo.entidades.detalle.some((d) => d.id === '5001' && d.resultado === 'actualizado'));
  assert.equal(cuerpo.escaneo.encoladas, 0, 'la conciliación también escanea oportunidades');
});

test('la conciliación horaria escanea todos los embudos: solo las fases de proyecto dan puntos', { skip: omitir }, async () => {
  sql('delete from public.clientify_cola_entidades');
  // Una oportunidad de eventos (GEENERA_ADS) en "Cierre" no es un proyecto; más de 100 oportunidades de otros contactos.
  clientify.oportunidades['6003'] = oportunidad(6003, 5001, 'Cierre', 900, { embudo: 'GEENERA_ADS' });
  for (let i = 0; i < 130; i++) clientify.oportunidades[String(7000 + i)] = oportunidad(7000 + i, 8000 + i, '3. Diseño', 1);
  const { status, cuerpo } = await cron('clientify-conciliacion');
  assert.equal(status, 200);
  assert.equal(cuerpo.escaneo.encoladas, 0, 'nada avanzó en un embudo de proyectos');
  assert.equal(cuerpo.escaneo.revisadas, Object.keys(clientify.oportunidades).length, 'recorre todas las páginas y todos los embudos');

  // Nueva oportunidad en OFF GRID, ya en Contrato y ganada: cuenta (todos los embudos de proyectos cuentan).
  clientify.oportunidades['6004'] = oportunidad(6004, 5001, '10. Contrato', 250000000, { embudo: 'GEENERA OFF GRID', status_desc: 'Won' });
  const r = await cron('clientify-conciliacion');
  assert.equal(r.cuerpo.escaneo.encoladas, 1);
  assert.deepEqual(r.cuerpo.entidades.detalle.find((d) => d.id === '6004').movimientos, ['negocio_cerrado']);
  assert.equal(empresa('5001', "e.clientify_deal_id || '|' || a.negocio_cerrado || '|' || a.estado_oportunidad"), '6004|si|ganada');
  // Cotizado: todas las oportunidades de proyectos (50 + 180 + 250 millones; la de eventos no cuenta).
  // Pipeline originado: solo la que se cerró (250 millones).
  assert.equal(empresa('5001', "a.valor_cotizado || '|' || a.valor_oportunidad"), '480000000|250000000');
  assert.equal((await cron('clientify-conciliacion')).cuerpo.escaneo.encoladas, 0, 'sin cambios no se vuelve a encolar');
});

test('el diagnóstico devuelve nombres y estructura, sin datos personales', { skip: omitir }, async () => {
  const { status, cuerpo } = await cron('clientify-diagnostico');
  assert.equal(status, 200);
  assert.equal(cuerpo.catalogos.campos_personalizados.ruta, '/custom-fields/?page_size=200');
  assert.equal(cuerpo.catalogos.etiquetas.ruta, '/contacts/tags/?page_size=200');
  assert.deepEqual(cuerpo.catalogos.campos_personalizados.elementos, [{ id: 1, name: 'ID_aliado', content_type: 'contact' }]);
  assert.equal(cuerpo.contactos.estructura.first_name, 'string');
  assert.ok(cuerpo.contactos.valores.status.includes('in-deal'));
  assert.ok(cuerpo.contactos.valores.nombres_campos_personalizados.includes('ID_aliado'));
  assert.ok(cuerpo.oportunidades.valores.pipeline_stage_desc.includes('6. Presentación de Oferta'));
  const texto = JSON.stringify(cuerpo);
  assert.ok(!texto.includes('@lead.test') && !texto.includes('+573105550000') && !texto.includes(codigo), 'sin correos, teléfonos ni códigos');
});
