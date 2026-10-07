// Tests del correo «Confirmación de empresa referida» con la invitación al MEDDPICC (CLAUDE.md §7): buzón por regional,
// contenido, envío con Resend (simulado) y la cola.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUZON_GENERAL, buzonMeddpicc } from '../../lib/correo/regiones.js';
import { ASUNTO, construirConfirmacion, enlaceMeddpicc } from '../../lib/correo/confirmacion.js';
import { enviarConResend, motivoResend } from '../../lib/correo/resend.js';
import { procesarCorreos } from '../../lib/correo/cola.js';
import admin from '../../api/admin/index.js';

const fila = (extra = {}) => ({ empresa_id: 'e0000000-0000-0000-0000-000000000001', empresa: 'Industrias Sol', ciudad: 'Bucaramanga, Santander',
  es_perfecto: true, aplica_meddpicc: true, nombre_aliado: 'Laura Pérez', correo_aliado: 'laura@aliada.test', codigo_aliado: 'EMLP23456789',
  estado_aliado: 'activo', intentos: 0, ...extra });

// Regionales ---------------------------------------------------------------------------------------------------------

test('regionales: primero la ciudad, luego el departamento; si no, el buzón general', () => {
  const casos = [
    ['Bucaramanga', 'oriente'], ['Cúcuta, Norte de Santander', 'oriente'], ['San Gil', 'oriente'],
    ['Barranquilla, Atlántico', 'costa'], ['CARTAGENA DE INDIAS', 'costa'], ['Santa Marta', 'costa'], ['Montería', 'costa'],
    ['Bogotá D.C.', 'centro'], ['Chía, Cundinamarca', 'centro'], ['Tunja', 'centro'], ['Ibagué', 'centro'], ['Villavicencio', 'centro'],
    ['Lebrija, Santander', 'oriente'], ['Pueblo X, Boyacá', 'centro'], ['Municipio, La Guajira', 'costa'],
    ['Medellín, Antioquia', null], ['Cali', null], ['Pasto', null], ['', null], [null, null], ['   ', null]
  ];
  for (const [ciudad, region] of casos) assert.equal(buzonMeddpicc(ciudad).region, region, String(ciudad));
  assert.equal(buzonMeddpicc('Bucaramanga').buzon, 'h.zambrano@geenera.com');
  assert.equal(buzonMeddpicc('Barranquilla').buzon, 'd.ariza@geenera.com');
  assert.equal(buzonMeddpicc('Bogotá').buzon, 'c.buitrago@geenera.com');
  assert.equal(buzonMeddpicc('Medellín').buzon, BUZON_GENERAL);
  assert.equal(BUZON_GENERAL, 'c.lizarazo@geenera.com');
});

// Contenido ------------------------------------------------------------------------------------------------------------

test('confirmación con MEDDPICC: asunto, las 8 preguntas, botón y «Responder a» de la regional', () => {
  const c = construirConfirmacion(fila(), { entorno: 'production' });
  assert.equal(c.asunto, ASUNTO);
  assert.equal(c.asunto, 'Confirmación de empresa referida');
  assert.equal(c.responderA, 'h.zambrano@geenera.com');
  for (const t of ['Métricas', 'Comprador económico', 'Criterios de decisión', 'Proceso de decisión', 'Proceso de papeles',
    'Dolor identificado', 'Campeón', 'Competencia']) {
    assert.ok(c.html.includes(t) && c.texto.includes(t), t);
  }
  assert.ok(c.html.includes('Gana 20 Puntos Sol adicionales con el MEDDPICC'));
  assert.ok(c.html.includes('Enviar mi MEDDPICC'));
  assert.ok(c.html.includes('mailto:h.zambrano@geenera.com?subject=' + encodeURIComponent('MEDDPICC · Industrias Sol · EMLP23456789')));
  assert.ok(c.texto.includes('no tienes plazo'));
  assert.ok(!c.html.includes('aún no está activa'), 'cuenta activa: sin aviso de puntos en espera');
});

test('confirmación sin MEDDPICC (imperfecto sin ciudad): solo confirma, sin bloque ni «Responder a»', () => {
  const c = construirConfirmacion(fila({ ciudad: '', es_perfecto: false, aplica_meddpicc: false }), { entorno: 'production' });
  assert.equal(c.responderA, null);
  assert.ok(c.html.includes('Recibimos tu referido <b>Industrias Sol</b>.'));
  assert.ok(!c.html.includes('MEDDPICC') && !c.texto.includes('MEDDPICC'));
  assert.ok(c.html.includes('no lo respondas'));
});

test('confirmación: imperfecto con ciudad fuera de las 3 regionales va al buzón general', () => {
  const c = construirConfirmacion(fila({ ciudad: 'Medellín', es_perfecto: false, aplica_meddpicc: true }));
  assert.equal(c.responderA, BUZON_GENERAL);
  assert.ok(c.html.includes('mailto:c.lizarazo@geenera.com'));
});

test('confirmación: cuenta pendiente avisa que los puntos quedan en espera; fuera de Production lleva [PRUEBA]', () => {
  const c = construirConfirmacion(fila({ estado_aliado: 'pendiente' }), { entorno: 'preview' });
  assert.equal(c.asunto, '[PRUEBA] Confirmación de empresa referida');
  assert.ok(c.html.includes('Tu cuenta aún no está activa') && c.texto.includes('Tu cuenta aún no está activa'));
});

test('confirmación: escapa el HTML de los datos escritos por el aliado', () => {
  const c = construirConfirmacion(fila({ empresa: '<script>x</script> & Cía', nombre_aliado: 'Ana "A"' }));
  assert.ok(!c.html.includes('<script>x'));
  assert.ok(c.html.includes('&lt;script&gt;x&lt;/script&gt; &amp; Cía'));
  assert.ok(enlaceMeddpicc('a@b.test', 'A & B', 'X').includes(encodeURIComponent('A & B')));
});

// Resend -----------------------------------------------------------------------------------------------------------------

test('resend: envía con la key, el remitente, «Responder a» y la clave de idempotencia', async () => {
  let pedido;
  const fetchFalso = async (url, op) => { pedido = { url, op }; return { ok: true, status: 200, json: async () => ({ id: 'm1' }) }; };
  const r = await enviarConResend({ apiKey: 'k', fetchImpl: fetchFalso, para: 'a@b.test', asunto: 'S', html: '<p>x</p>', texto: 'x',
    responderA: 'r@geenera.com', idempotencia: 'confirmacion-referido/1' });
  assert.equal(r.id, 'm1');
  assert.equal(pedido.url, 'https://api.resend.com/emails');
  assert.equal(pedido.op.headers.authorization, 'Bearer k');
  assert.equal(pedido.op.headers['idempotency-key'], 'confirmacion-referido/1');
  const cuerpo = JSON.parse(pedido.op.body);
  assert.deepEqual(cuerpo.to, ['a@b.test']);
  assert.equal(cuerpo.reply_to, 'r@geenera.com');
  assert.match(cuerpo.from, /no-reply@notificaciones\.geenera\.com/);
});

test('resend: motivos legibles y sin correos para el panel', async () => {
  assert.match(motivoResend(429, { name: 'daily_quota_exceeded' }), /límite diario/);
  assert.match(motivoResend(429, { name: 'monthly_quota_exceeded' }), /límite mensual/);
  assert.match(motivoResend(429, {}), /demasiados envíos/);
  assert.match(motivoResend(401, {}), /API key no es válida/);
  assert.equal(motivoResend(422, { message: 'Invalid `to` field: laura@aliada.test' }).includes('laura@aliada.test'), false);
  await assert.rejects(enviarConResend({ apiKey: '', para: 'a@b.test' }), /Falta configurar RESEND_API_KEY/);
  await assert.rejects(enviarConResend({ apiKey: 'k', para: 'a@b.test', fetchImpl: async () => { throw new Error('red'); } }), /no se pudo conectar/);
});

// Cola ---------------------------------------------------------------------------------------------------------------------

function supabaseCola(lote) {
  const llamadas = [];
  return { llamadas, rpc: async (nombre, args) => { llamadas.push({ nombre, args }); return { data: nombre === 'correos_referido_reclamar' ? lote : null, error: null }; } };
}

test('cola: envía cada correo y registra el resultado; un fallo guarda el motivo', async () => {
  const sb = supabaseCola([fila(), fila({ empresa_id: 'e0000000-0000-0000-0000-000000000002', codigo_aliado: 'EMXX23456789' })]);
  let n = 0;
  const fetchFalso = async () => (++n === 1
    ? { ok: true, status: 200, json: async () => ({ id: 'm1' }) }
    : { ok: false, status: 429, json: async () => ({ name: 'daily_quota_exceeded' }) });
  const r = await procesarCorreos({ supabase: sb, entorno: 'production', env: { RESEND_API_KEY: 'k' }, fetchImpl: fetchFalso });
  assert.equal(r.ok, 1);
  assert.equal(r.errores, 1);
  const resultados = sb.llamadas.filter((l) => l.nombre === 'correos_referido_resultado');
  assert.deepEqual(resultados[0].args, { p_empresa: 'e0000000-0000-0000-0000-000000000001', p_error: null });
  assert.match(resultados[1].args.p_error, /límite diario/);
  assert.ok(!JSON.stringify(r).includes('laura@aliada.test'), 'el resumen no lleva correos');
});

test('cola: sin RESEND_API_KEY no llama a Resend y deja el motivo para el panel', async () => {
  const sb = supabaseCola([fila()]);
  let llamado = false;
  await procesarCorreos({ supabase: sb, env: {}, fetchImpl: async () => { llamado = true; } });
  assert.equal(llamado, false);
  assert.match(sb.llamadas.find((l) => l.nombre === 'correos_referido_resultado').args.p_error, /RESEND_API_KEY/);
});

// Panel ------------------------------------------------------------------------------------------------------------------

const ADMIN = { id: 'a0000000-0000-0000-0000-00000000000a', codigo_aliado: 'EMZA23456789', estado: 'activo', rol: 'admin' };
const EMPRESA = 'e0000000-0000-0000-0000-000000000009';
function supabaseAdmin(lote = []) {
  const llamadas = [];
  return {
    llamadas,
    auth: { getUser: async () => ({ data: { user: { id: ADMIN.id } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ADMIN, error: null }) }) }) }),
    rpc: async (nombre, args) => {
      llamadas.push({ nombre, args });
      if (nombre === 'correos_referido_reclamar') return { data: lote, error: null };
      return { data: { ok: true }, error: null };
    }
  };
}
const respuesta = () => ({ statusCode: 0, cuerpo: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; }, json(d) { this.cuerpo = d; return this; } });
const pedido = (cuerpo) => ({ method: 'POST', headers: { authorization: 'Bearer token' }, body: cuerpo });

test('panel: otorgar el MEDDPICC usa el admin de la sesión', async () => {
  const sb = supabaseAdmin();
  const res = respuesta();
  await admin(pedido({ accion: 'otorgar_meddpicc', empresa_id: EMPRESA, nota: 'Recibido', p_admin: 'otro' }), res, sb);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sb.llamadas[0], { nombre: 'admin_otorgar_meddpicc', args: { p_admin: ADMIN.id, p_empresa: EMPRESA, p_nota: 'Recibido' } });
});

test('panel: reintentar un correo lo vuelve a la cola y lo envía enseguida', async () => {
  const sb = supabaseAdmin([fila({ empresa_id: EMPRESA })]);
  const res = respuesta();
  await admin(pedido({ accion: 'reintentar_correo', empresa_id: EMPRESA }), res, sb,
    { entorno: { RESEND_API_KEY: 'k', VERCEL_ENV: 'production' }, fetch: async () => ({ ok: true, status: 200, json: async () => ({ id: 'm' }) }) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.cuerpo, { empresa_id: EMPRESA, enviado: true, error: null });
  assert.deepEqual(sb.llamadas.map((l) => l.nombre), ['admin_reintentar_correo', 'correos_referido_reclamar', 'correos_referido_resultado']);

  const sb2 = supabaseAdmin([fila({ empresa_id: EMPRESA })]);
  const res2 = respuesta();
  await admin(pedido({ accion: 'reintentar_correo', empresa_id: EMPRESA }), res2, sb2,
    { entorno: { RESEND_API_KEY: 'k' }, fetch: async () => ({ ok: false, status: 429, json: async () => ({ name: 'daily_quota_exceeded' }) }) });
  assert.equal(res2.cuerpo.enviado, false);
  assert.match(res2.cuerpo.error, /límite diario/);
});
