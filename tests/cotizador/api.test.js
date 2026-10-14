// Tests de POST /api/cotizador (lib/cotizador.js) con Supabase y Cloudflare Turnstile simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import cotizador from '../../api/cotizador.js';
import { MENSAJE_ALIADO, MENSAJE_CAPTCHA, MENSAJE_LIMITE, huellaCotizador, validarSimulacion } from '../../lib/cotizador.js';

const ENTORNO = { SUPABASE_SECRET_KEY: 'clave-servidor', TURNSTILE_SECRET_KEY: 'secreto-turnstile', VERCEL_ENV: 'preview' };
const ID = '7b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a40';

function respuesta() {
  return { statusCode: 0, cuerpo: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { this.cuerpo = d; return this; } };
}
function supabaseFalso(rpc = {}) {
  const llamadas = [];
  return {
    llamadas,
    rpc: async (nombre, args) => {
      llamadas.push({ nombre, args });
      const r = rpc[nombre];
      return typeof r === 'function' ? r(args) : (r || { data: null, error: null });
    }
  };
}
const captchaOk = async () => ({ json: async () => ({ success: true }) });
const captchaMal = async () => ({ json: async () => ({ success: false }) });
const pedido = (cuerpo, ip = '190.0.0.1') => ({ method: 'POST', headers: { 'x-forwarded-for': ip }, body: cuerpo });
const INDUSTRIAL = {
  accion: 'simular', captcha: 'tk', segmento: 'industrial', unidad: 'cop', valor: '10.000.000', aislado: false, bateria: 'none', autoriza: true,
  datos: { empresa: ' Plásticos  del Caribe ', contacto: 'Ana Pérez', subsector: 'Plásticos', telefono: '+573001234567', correo: ' Ana+Prueba@Empresa.test ', ciudad: 'Barranquilla|Atlántico', nombre: 'no se guarda' }
};
const RESIDENCIAL = {
  accion: 'simular', captcha: 'tk', segmento: 'residencial', unidad: 'kwh', valor: '450', aislado: true, bateria: 'autonomia', autoriza: true,
  datos: { nombre: 'Juan Gómez', telefono: '+573001234567', correo: 'juan@correo.test', ciudad: 'Medellín|Antioquia', empresa: 'no se guarda' }
};
const ok = { cotizador_intento: { data: true, error: null }, cotizador_registrar_simulacion: { data: ID, error: null } };

test('simular: guarda los datos y los resultados recalculados en el servidor', async () => {
  const sb = supabaseFalso(ok);
  const res = respuesta();
  await cotizador(pedido({ ...INDUSTRIAL, potencia_kwp: 99999 }), res, { supabase: sb, entorno: ENTORNO, fetch: captchaOk });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.cuerpo, { id: ID });
  const { args } = sb.llamadas.find((l) => l.nombre === 'cotizador_registrar_simulacion');
  assert.equal(args.p_segmento, 'industrial');
  const f = args.p_fila;
  assert.equal(f.empresa, 'Plásticos del Caribe');
  assert.equal(f.correo, 'ana+prueba@empresa.test');
  assert.equal(f.nombre, undefined, 'el residencial no aplica a una empresa');
  assert.deepEqual([f.ciudad, f.departamento, f.region], ['Barranquilla', 'Atlántico', 'Costa']);
  assert.equal(f.potencia_kwp, 110.7, 'la potencia la calcula el servidor, no la manda el navegador');
  assert.equal(f.conectado_red, true);
  assert.equal(f.almacenamiento, 'none');
  assert.ok(!('aliado_id' in f) && !('codigo_aliado' in f), 'el cotizador no guarda al aliado');
});

test('simular: residencial aislado', async () => {
  const sb = supabaseFalso(ok);
  const res = respuesta();
  await cotizador(pedido(RESIDENCIAL), res, { supabase: sb, entorno: ENTORNO, fetch: captchaOk });
  assert.equal(res.statusCode, 201);
  const f = sb.llamadas.find((l) => l.nombre === 'cotizador_registrar_simulacion').args.p_fila;
  assert.equal(f.nombre, 'Juan Gómez');
  assert.equal(f.empresa, undefined);
  assert.equal(f.conectado_red, false);
  assert.equal(f.ahorro_anual_cop, null);
});

test('simular: validación con mensajes para la persona', () => {
  const caso = (cambio) => { try { validarSimulacion({ ...INDUSTRIAL, ...cambio, datos: { ...INDUSTRIAL.datos, ...(cambio.datos || {}) } }); return null; } catch (e) { return [e.status, e.message]; } };
  assert.deepEqual(caso({ segmento: 'otro' }), [422, 'Elige el tipo de proyecto.']);
  assert.deepEqual(caso({ datos: { empresa: '' } }), [422, 'Escribe el nombre de la empresa.']);
  assert.deepEqual(caso({ datos: { subsector: 'Inventado' } }), [422, 'Selecciona el subsector.']);
  assert.deepEqual(caso({ datos: { telefono: '+572001234567' } }), [422, 'Revisa el teléfono.']);
  assert.deepEqual(caso({ datos: { correo: 'sin-arroba' } }), [422, 'Revisa el correo.']);
  assert.deepEqual(caso({ datos: { ciudad: 'Barranquilla' } }), [422, 'Selecciona la ciudad.']);
  assert.deepEqual(caso({ valor: '20.000' }), [422, 'El valor mínimo de la factura es $27.600 al mes.']);
  assert.deepEqual(caso({ unidad: 'kwh', valor: '30' }), [422, 'El consumo mínimo es 40 kWh al mes.']);
  assert.deepEqual(caso({ bateria: 'extendida' }), [422, 'Elige el almacenamiento.']);
  assert.deepEqual(caso({ aislado: true, bateria: 'none' }), [422, 'Elige el almacenamiento.']);
  assert.deepEqual(caso({ autoriza: false }), [422, 'Marca la autorización de tratamiento de datos para continuar.']);
  assert.equal(caso({}), null);
});

test('simular: captcha y límite por conexión', async () => {
  let res = respuesta();
  await cotizador(pedido(INDUSTRIAL), res, { supabase: supabaseFalso(ok), entorno: ENTORNO, fetch: captchaMal });
  assert.deepEqual([res.statusCode, res.cuerpo.error], [403, MENSAJE_CAPTCHA]);

  const sb = supabaseFalso({ ...ok, cotizador_intento: { data: false, error: null } });
  res = respuesta();
  await cotizador(pedido(INDUSTRIAL, '200.1.2.3'), res, { supabase: sb, entorno: ENTORNO, fetch: captchaOk });
  assert.deepEqual([res.statusCode, res.cuerpo.error], [429, MENSAJE_LIMITE]);
  const huella = sb.llamadas[0].args.p_huella;
  assert.equal(huella, huellaCotizador('200.1.2.3', ENTORNO.SUPABASE_SECRET_KEY));
  assert.ok(!huella.includes('200.1.2.3'), 'la IP no se guarda');
  assert.ok(!sb.llamadas.some((l) => l.nombre === 'cotizador_registrar_simulacion'));
});

test('propuesta: la pone en la cola y responde aunque Clientify no esté configurado', async () => {
  const sb = supabaseFalso({ cotizador_intento: { data: true, error: null }, cotizador_solicitar_propuesta: { data: { estado: 'pendiente' }, error: null } });
  const res = respuesta();
  await cotizador(pedido({ accion: 'propuesta', segmento: 'industrial', id: ID }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.cuerpo, { ok: true, clientify: 'pendiente' });
  assert.deepEqual(sb.llamadas.find((l) => l.nombre === 'cotizador_solicitar_propuesta').args, { p_segmento: 'industrial', p_id: ID, p_referente: null });
});

const colaOk = { cotizador_intento: { data: true, error: null }, cotizador_solicitar_propuesta: { data: { estado: 'pendiente' }, error: null } };

test('paso 2: avisa si el correo es de un aliado', async () => {
  const sb = supabaseFalso({ cotizador_intento: { data: true, error: null },
    cotizador_correo_es_aliado: ({ p_correo }) => ({ data: p_correo === 'aliado@correo.test', error: null }) });
  let res = respuesta();
  await cotizador(pedido({ accion: 'correo', correo: ' Aliado@Correo.test ' }), res, { supabase: sb, entorno: ENTORNO });
  assert.deepEqual([res.statusCode, res.cuerpo], [200, { aliado: true }]);
  res = respuesta();
  await cotizador(pedido({ accion: 'correo', correo: 'empresa@correo.test' }), res, { supabase: sb, entorno: ENTORNO });
  assert.deepEqual(res.cuerpo, { aliado: false });
  res = respuesta();
  await cotizador(pedido({ accion: 'correo', correo: 'no-es-correo' }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 422);
  assert.equal(sb.llamadas.filter((l) => l.nombre === 'cotizador_intento').length, 3, 'cada revisión cuenta como intento');
});

test('simular: no guarda si el correo es de un aliado', async () => {
  const sb = supabaseFalso({ ...ok, cotizador_correo_es_aliado: { data: true, error: null } });
  const res = respuesta();
  await cotizador(pedido(INDUSTRIAL), res, { supabase: sb, entorno: ENTORNO, fetch: captchaOk });
  assert.equal(res.statusCode, 422);
  assert.equal(res.cuerpo.error, MENSAJE_ALIADO);
  assert.ok(!sb.llamadas.some((l) => l.nombre === 'cotizador_registrar_simulacion'));
});

test('propuesta sin sesión: el correo de quien refiere da el ID_aliado; uno desconocido se ignora', async () => {
  const sb = supabaseFalso({ ...colaOk,
    cotizador_codigo_referente: ({ p_correo }) => ({ data: p_correo === 'aliado@correo.test' ? 'EMABCD2345XY' : null, error: null }) });
  await cotizador(pedido({ accion: 'propuesta', segmento: 'industrial', id: ID, correo_referente: ' Aliado@Correo.test ' }), respuesta(), { supabase: sb, entorno: ENTORNO });
  await cotizador(pedido({ accion: 'propuesta', segmento: 'industrial', id: ID, correo_referente: 'otro@correo.test' }), respuesta(), { supabase: sb, entorno: ENTORNO });
  await cotizador(pedido({ accion: 'propuesta', segmento: 'industrial', id: ID, correo_referente: 'no-es-correo' }), respuesta(), { supabase: sb, entorno: ENTORNO });
  const referentes = sb.llamadas.filter((l) => l.nombre === 'cotizador_solicitar_propuesta').map((l) => l.args.p_referente);
  assert.deepEqual(referentes, ['EMABCD2345XY', null, null]);
  assert.equal(sb.llamadas.filter((l) => l.nombre === 'cotizador_codigo_referente').length, 2, 'un correo inválido ni se consulta');
});

test('propuesta con sesión: usa el aliado de la sesión e ignora el correo escrito; una sesión vencida no falla', async () => {
  const aliados = { 'u-1': { id: 'u-1', codigo_aliado: 'FIJJPL7K4MQ9TX', estado: 'activo', rol: 'aliado' } };
  const sb = supabaseFalso({ ...colaOk, cotizador_codigo_referente: { data: 'OTRO', error: null } });
  sb.auth = { getUser: async (t) => (t === 'bueno' ? { data: { user: { id: 'u-1' } }, error: null } : { data: null, error: { message: 'jwt' } }) };
  sb.from = () => ({ select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: aliados[id] || null, error: null }) }) }) });
  const conToken = (t, cuerpo) => ({ ...pedido(cuerpo), headers: { 'x-forwarded-for': '190.0.0.1', authorization: 'Bearer ' + t } });
  let res = respuesta();
  await cotizador(conToken('bueno', { accion: 'propuesta', segmento: 'industrial', id: ID, correo_referente: 'aliado@correo.test' }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 200);
  res = respuesta();
  await cotizador(conToken('vencido', { accion: 'propuesta', segmento: 'industrial', id: ID }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 200);
  const referentes = sb.llamadas.filter((l) => l.nombre === 'cotizador_solicitar_propuesta').map((l) => l.args.p_referente);
  assert.deepEqual(referentes, ['FIJJPL7K4MQ9TX', null]);
  assert.ok(!sb.llamadas.some((l) => l.nombre === 'cotizador_codigo_referente'), 'con sesión no se usa el correo escrito');
});

test('propuesta: simulación vencida o datos inválidos', async () => {
  const sb = supabaseFalso({ cotizador_intento: { data: true, error: null },
    cotizador_solicitar_propuesta: { data: null, error: { message: 'simulacion_inexistente: la simulación no existe o ya venció' } } });
  let res = respuesta();
  await cotizador(pedido({ accion: 'propuesta', segmento: 'industrial', id: ID }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 404);
  res = respuesta();
  await cotizador(pedido({ accion: 'propuesta', segmento: 'industrial', id: 'x' }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 400);
  res = respuesta();
  await cotizador(pedido({ accion: 'otra' }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 400);
  res = respuesta();
  await cotizador({ method: 'GET', headers: {} }, res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 405);
});

test('captcha: en Production sin clave secreta el cotizador no guarda (503)', async () => {
  const res = respuesta();
  await cotizador(pedido(INDUSTRIAL), res, { supabase: supabaseFalso(ok), entorno: { SUPABASE_SECRET_KEY: 'k', VERCEL_ENV: 'production' } });
  assert.equal(res.statusCode, 503);
});
