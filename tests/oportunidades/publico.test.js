// Tests del formulario público de referidos (lib/referido-publico.js, /api/oportunidades y /api/oportunidades/factura
// con `publico: true`) con Supabase y Cloudflare Turnstile simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import oportunidades from '../../api/oportunidades/index.js';
import factura from '../../api/oportunidades/factura.js';
import { huellaDeConexion, ipDelPedido, MENSAJE_AMBIGUO, MENSAJE_CAPTCHA, MENSAJE_LIMITE, verificarCaptcha } from '../../lib/referido-publico.js';

const ENTORNO = { SUPABASE_SECRET_KEY: 'clave-servidor', TURNSTILE_SECRET_KEY: 'secreto-turnstile', VERCEL_ENV: 'preview' };
const EMPRESA = '7b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a40';
const DATOS = { empresa: 'Industrias Sol', sector: 'Industrial', nombre_contacto: 'Laura', telefono: '+573105551234',
  correo: 'laura@cliente.test', valor_factura: 1000, autorizacion_contacto: true, extra: 'no se envía' };

function respuesta() {
  return { statusCode: 0, cuerpo: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { this.cuerpo = d; return this; } };
}

// Supabase simulado: rpc configurable por nombre y Storage que registra subidas y borrados.
function supabaseFalso({ rpc = {}, sesion = null } = {}) {
  const llamadas = [];
  const borrados = [];
  return {
    llamadas, borrados,
    auth: { getUser: async () => (sesion ? { data: { user: { id: sesion } }, error: null } : { data: null, error: { message: 'sin sesión' } }) },
    rpc: async (nombre, args) => {
      llamadas.push({ nombre, args });
      const r = rpc[nombre];
      return typeof r === 'function' ? r(args) : (r || { data: null, error: null });
    },
    storage: { from: () => ({
      createSignedUploadUrl: async (ruta) => ({ data: { path: ruta, token: 'tok' }, error: null }),
      remove: async (rutas) => { borrados.push(...rutas); return { error: null }; }
    }) }
  };
}

const captchaOk = async () => ({ json: async () => ({ success: true }) });
const captchaMal = async () => ({ json: async () => ({ success: false }) });
const pedido = (cuerpo, ip = '190.0.0.1') => ({ method: 'POST', headers: { 'x-forwarded-for': ip + ', 10.0.0.1' }, body: cuerpo });
const base = (extra = {}) => ({ publico: true, captcha: 'tk', correo_aliado: ' Aliada@Correo.test ', empresa_id: EMPRESA, datos: DATOS, ...extra });
const okRegistro = { referido_publico_intento: { data: true, error: null },
  registrar_oportunidad_publica: { data: { es_perfecto: false, puntos: 5 }, error: null } };

test('público: huella HMAC de la IP (nunca la IP) y la IP sale del primer x-forwarded-for', () => {
  assert.equal(ipDelPedido(pedido({}, '200.1.2.3')), '200.1.2.3');
  const h = huellaDeConexion('200.1.2.3', 'k');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, huellaDeConexion('200.1.2.3', 'otra'), 'depende de la clave del servidor');
  assert.ok(!h.includes('200'), 'la IP no aparece en la huella');
});

test('público: registra con el correo del aliado y responde solo es_perfecto y puntos', async () => {
  const sb = supabaseFalso({ rpc: okRegistro });
  const res = respuesta();
  await oportunidades(pedido(base()), res, { supabase: sb, entorno: ENTORNO, fetch: captchaOk });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.cuerpo, { es_perfecto: false, puntos: 5, clientify: 'pendiente' });
  const llamada = sb.llamadas.find((l) => l.nombre === 'registrar_oportunidad_publica');
  assert.equal(llamada.args.p_correo_aliado, 'aliada@correo.test');
  assert.equal(llamada.args.p_empresa_id, EMPRESA);
  assert.ok(!('extra' in llamada.args.p_datos), 'solo los campos conocidos');
  assert.equal(sb.llamadas[0].nombre, 'referido_publico_intento', 'primero cuenta el intento de la conexión');
  assert.match(sb.llamadas[0].args.p_huella, /^[0-9a-f]{64}$/);
});

test('público: sin captcha válido no llega a la base (403)', async () => {
  const sb = supabaseFalso({ rpc: okRegistro });
  const res = respuesta();
  await oportunidades(pedido(base()), res, { supabase: sb, entorno: ENTORNO, fetch: captchaMal });
  assert.equal(res.statusCode, 403);
  assert.equal(res.cuerpo.error, MENSAJE_CAPTCHA);
  assert.ok(!sb.llamadas.some((l) => l.nombre === 'registrar_oportunidad_publica'));
});

test('público: correo que no es de un aliado, cuenta que no puede referir o autorreferido → el mismo mensaje ambiguo', async () => {
  for (const codigo of ['referidor_invalido', 'aliado_no_activo', 'autorreferido']) {
    const sb = supabaseFalso({ rpc: { ...okRegistro, registrar_oportunidad_publica: { data: null, error: { message: codigo + ': detalle interno' } } } });
    const res = respuesta();
    await oportunidades(pedido(base()), res, { supabase: sb, entorno: ENTORNO, fetch: captchaOk });
    assert.equal(res.statusCode, 422, codigo);
    assert.equal(res.cuerpo.error, MENSAJE_AMBIGUO, codigo);
  }
});

test('público: el límite por conexión responde 429 sin registrar', async () => {
  const sb = supabaseFalso({ rpc: { ...okRegistro, referido_publico_intento: { data: false, error: null } } });
  const res = respuesta();
  await oportunidades(pedido(base()), res, { supabase: sb, entorno: ENTORNO, fetch: captchaOk });
  assert.equal(res.statusCode, 429);
  assert.equal(res.cuerpo.error, MENSAJE_LIMITE);
  assert.equal(sb.llamadas.length, 1);
});

test('público: correo de quien refiere inválido → 422 antes de ir a la base', async () => {
  const sb = supabaseFalso({ rpc: okRegistro });
  const res = respuesta();
  await oportunidades(pedido(base({ correo_aliado: 'no-es-correo' })), res, { supabase: sb, entorno: ENTORNO, fetch: captchaOk });
  assert.equal(res.statusCode, 422);
  assert.ok(!sb.llamadas.some((l) => l.nombre === 'registrar_oportunidad_publica'));
});

test('público con factura: solo la carpeta publico/{empresa}; si el registro falla se borra la factura', async () => {
  let sb = supabaseFalso({ rpc: okRegistro });
  let res = respuesta();
  await oportunidades(pedido(base({ factura: { ruta: `algun-aliado/${EMPRESA}/f.pdf` } })), res, { supabase: sb, entorno: ENTORNO, fetch: captchaOk });
  assert.equal(res.statusCode, 422);

  sb = supabaseFalso({ rpc: { ...okRegistro, registrar_oportunidad_publica: { data: null, error: { message: 'referido_duplicado: x' } } } });
  res = respuesta();
  await oportunidades(pedido(base({ captcha: null, factura: { ruta: `publico/${EMPRESA}/f.pdf`, nombre_archivo: 'f.pdf' } })), res,
    { supabase: sb, entorno: ENTORNO, fetch: captchaMal });
  assert.equal(res.statusCode, 409, 'con factura el captcha ya se verificó al pedir la subida (la base exige el permiso)');
  assert.deepEqual(sb.borrados, [`publico/${EMPRESA}/f.pdf`]);
});

test('público: pedir la subida de la factura verifica el captcha, usa publico/{empresa} y crea el permiso', async () => {
  const sb = supabaseFalso({ rpc: { referido_publico_intento: { data: true, error: null } } });
  const res = respuesta();
  await factura(pedido({ publico: true, captcha: 'tk', nombre_archivo: 'Mi factura.pdf', tipo: 'application/pdf', tamano: 1000 }), res,
    { supabase: sb, entorno: ENTORNO, fetch: captchaOk });
  assert.equal(res.statusCode, 200);
  assert.match(res.cuerpo.ruta, /^publico\/[0-9a-f-]{36}\/Mi-factura\.pdf$/);
  const permiso = sb.llamadas.find((l) => l.nombre === 'referido_publico_permiso');
  assert.equal(permiso.args.p_empresa_id, res.cuerpo.empresa_id);
  assert.ok(!JSON.stringify(res.cuerpo).includes('correo'), 'este paso no pide ni revela nada del aliado');

  const res2 = respuesta();
  await factura(pedido({ publico: true, captcha: 'tk', nombre_archivo: 'f.pdf', tipo: 'application/pdf', tamano: 1000 }), res2,
    { supabase: supabaseFalso({ rpc: { referido_publico_intento: { data: true, error: null } } }), entorno: ENTORNO, fetch: captchaMal });
  assert.equal(res2.statusCode, 403);
});

test('con sesión no cambia: sin token responde 401', async () => {
  const res = respuesta();
  await oportunidades({ method: 'POST', headers: {}, body: { empresa_id: EMPRESA, datos: DATOS } }, res, { supabase: supabaseFalso(), entorno: ENTORNO });
  assert.equal(res.statusCode, 401);
});

test('captcha: sin clave secreta se omite fuera de Production y en Production el formulario no funciona', async () => {
  assert.equal(await verificarCaptcha(null, { secreto: '', entorno: 'preview' }), true);
  await assert.rejects(verificarCaptcha('tk', { secreto: '', entorno: 'production' }), (e) => e.status === 503);
  assert.equal(await verificarCaptcha('', { secreto: 's', entorno: 'production', fetchImpl: captchaOk }), false, 'sin token no pasa');
  let enviado;
  await verificarCaptcha('tk', { secreto: 's', ip: '1.2.3.4', entorno: 'production', fetchImpl: async (url, o) => { enviado = { url, cuerpo: String(o.body) }; return { json: async () => ({ success: true }) }; } });
  assert.equal(enviado.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.match(enviado.cuerpo, /secret=s&response=tk&remoteip=1\.2\.3\.4/);
});
