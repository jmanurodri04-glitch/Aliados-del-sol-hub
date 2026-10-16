// Tests de POST /api/cotizador (lib/cotizador.js) con Supabase simulado. Solo para aliados con sesión (16 oct 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import cotizador from '../../api/cotizador.js';
import { MENSAJE_ALIADO, MENSAJE_LIMITE, MENSAJE_SOLO_ALIADOS, huellaCotizador, mensajeNombreRepetido, validarSimulacion } from '../../lib/cotizador.js';

const ENTORNO = { SUPABASE_SECRET_KEY: 'clave-servidor', VERCEL_ENV: 'preview' };
const ID = '7b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a40';
const ALIADOS = {
  'u-1': { id: 'u-1', codigo_aliado: 'FIJJPL7K4MQ9TX', estado: 'activo', rol: 'aliado' },
  'u-2': { id: 'u-2', codigo_aliado: 'FIADMIN', estado: 'activo', rol: 'admin' },
  'u-3': { id: 'u-3', codigo_aliado: 'FISUSP', estado: 'suspendido', rol: 'aliado' }
};
const TOKENS = { bueno: 'u-1', admin: 'u-2', suspendido: 'u-3' };

function respuesta() {
  return { statusCode: 0, cuerpo: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { this.cuerpo = d; return this; } };
}
function supabaseFalso(rpc = {}) {
  const llamadas = [];
  return {
    llamadas,
    auth: { getUser: async (t) => (TOKENS[t] ? { data: { user: { id: TOKENS[t] } }, error: null } : { data: null, error: { message: 'jwt' } }) },
    from: () => ({ select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: ALIADOS[id] || null, error: null }) }) }) }),
    rpc: async (nombre, args) => {
      llamadas.push({ nombre, args });
      const r = rpc[nombre];
      return typeof r === 'function' ? r(args) : (r || { data: null, error: null });
    }
  };
}
const pedido = (cuerpo, token = 'bueno') => ({ method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body: cuerpo });
const INDUSTRIAL = {
  accion: 'simular', segmento: 'industrial', unidad: 'cop', valor: '10.000.000', aislado: false, bateria: 'none', autoriza: true,
  datos: { empresa: ' Plásticos  del Caribe ', contacto: 'Ana Pérez', subsector: 'Plásticos', telefono: '+573001234567', correo: ' Ana+Prueba@Empresa.test ', ciudad: 'Barranquilla|Atlántico', nombre: 'no se guarda' }
};
const RESIDENCIAL = {
  accion: 'simular', segmento: 'residencial', unidad: 'kwh', valor: '450', aislado: true, bateria: 'autonomia', autoriza: true,
  datos: { nombre: 'Juan Gómez', telefono: '+573001234567', correo: 'juan@correo.test', ciudad: 'Medellín|Antioquia', empresa: 'no se guarda' }
};
const intentoOk = { cotizador_intento: { data: true, error: null } };
const ok = { ...intentoOk, cotizador_guardar_simulacion: { data: ID, error: null } };
const llamada = (sb, nombre) => sb.llamadas.find((l) => l.nombre === nombre);

test('sin sesión, con sesión vencida, de admin o de una cuenta no activa: no se usa', async () => {
  for (const [token, status] of [[null, 401], ['vencido', 401], ['suspendido', 403], ['admin', 403]]) {
    const sb = supabaseFalso(ok);
    const res = respuesta();
    await cotizador(pedido(INDUSTRIAL, token), res, { supabase: sb, entorno: ENTORNO });
    assert.equal(res.statusCode, status, String(token));
    assert.ok(!llamada(sb, 'cotizador_guardar_simulacion'));
  }
  const res = respuesta();
  await cotizador(pedido(INDUSTRIAL, 'admin'), res, { supabase: supabaseFalso(ok), entorno: ENTORNO });
  assert.equal(res.cuerpo.error, MENSAJE_SOLO_ALIADOS);
});

test('simular: guarda a nombre del aliado de la sesión, con los resultados recalculados en el servidor', async () => {
  const sb = supabaseFalso(ok);
  const res = respuesta();
  await cotizador(pedido({ ...INDUSTRIAL, potencia_kwp: 99999, aliado_id: 'u-9' }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.cuerpo, { id: ID });
  const { args } = llamada(sb, 'cotizador_guardar_simulacion');
  assert.equal(args.p_aliado, 'u-1', 'el aliado sale de la sesión, nunca del cuerpo');
  assert.equal(args.p_segmento, 'industrial');
  assert.equal(args.p_id, null, 'sin id: cotización nueva');
  const f = args.p_fila;
  assert.equal(f.empresa, 'Plásticos del Caribe');
  assert.equal(f.correo, 'ana+prueba@empresa.test');
  assert.equal(f.nombre, undefined, 'el residencial no aplica a una empresa');
  assert.deepEqual([f.ciudad, f.departamento, f.region], ['Barranquilla', 'Atlántico', 'Costa']);
  assert.equal(f.potencia_kwp, 110.7, 'la potencia la calcula el servidor, no la manda el navegador');
  assert.ok(!('aliado_id' in f), 'el aliado va aparte, no en la fila');
});

test('simular: con id actualiza la misma cotización; un id inválido se ignora', async () => {
  const sb = supabaseFalso(ok);
  await cotizador(pedido({ ...RESIDENCIAL, id: ID }), respuesta(), { supabase: sb, entorno: ENTORNO });
  await cotizador(pedido({ ...RESIDENCIAL, id: 'no-es-uuid' }), respuesta(), { supabase: sb, entorno: ENTORNO });
  const ids = sb.llamadas.filter((l) => l.nombre === 'cotizador_guardar_simulacion').map((l) => l.args.p_id);
  assert.deepEqual(ids, [ID, null]);
  const f = llamada(sb, 'cotizador_guardar_simulacion').args.p_fila;
  assert.equal(f.nombre, 'Juan Gómez');
  assert.equal(f.conectado_red, false);
  assert.equal(f.ahorro_anual_cop, null);
});

test('simular: nombre repetido → 409 con el mensaje para agregar un número', async () => {
  const sb = supabaseFalso({ ...intentoOk, cotizador_guardar_simulacion: { data: null, error: { message: 'nombre_repetido: ya tienes una cotización con ese nombre' } } });
  const res = respuesta();
  await cotizador(pedido(INDUSTRIAL), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 409);
  assert.equal(res.cuerpo.error, mensajeNombreRepetido('Plásticos del Caribe'));
  assert.match(res.cuerpo.error, /«Plásticos del Caribe 2»/);
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

test('límite de intentos por aliado (huella HMAC del id)', async () => {
  const sb = supabaseFalso({ ...ok, cotizador_intento: { data: false, error: null } });
  const res = respuesta();
  await cotizador(pedido(INDUSTRIAL), res, { supabase: sb, entorno: ENTORNO });
  assert.deepEqual([res.statusCode, res.cuerpo.error], [429, MENSAJE_LIMITE]);
  const huella = sb.llamadas[0].args.p_huella;
  assert.equal(huella, huellaCotizador('u-1', ENTORNO.SUPABASE_SECRET_KEY));
  assert.ok(!huella.includes('u-1'));
  assert.ok(!llamada(sb, 'cotizador_guardar_simulacion'));
});

test('simular: no guarda si el correo es de un aliado', async () => {
  const sb = supabaseFalso({ ...ok, cotizador_correo_es_aliado: { data: true, error: null } });
  const res = respuesta();
  await cotizador(pedido(INDUSTRIAL), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 422);
  assert.equal(res.cuerpo.error, MENSAJE_ALIADO);
  assert.ok(!llamada(sb, 'cotizador_guardar_simulacion'));
});

test('paso 2: avisa si el correo es de un aliado', async () => {
  const sb = supabaseFalso({ ...intentoOk, cotizador_correo_es_aliado: ({ p_correo }) => ({ data: p_correo === 'aliado@correo.test', error: null }) });
  let res = respuesta();
  await cotizador(pedido({ accion: 'correo', correo: ' Aliado@Correo.test ' }), res, { supabase: sb, entorno: ENTORNO });
  assert.deepEqual([res.statusCode, res.cuerpo], [200, { aliado: true }]);
  res = respuesta();
  await cotizador(pedido({ accion: 'correo', correo: 'no-es-correo' }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 422);
});

test('paso 2: el nombre no se repite entre las cotizaciones del aliado', async () => {
  const sb = supabaseFalso({ ...intentoOk, cotizador_nombre_disponible: ({ p_nombre }) => ({ data: p_nombre !== 'Plásticos del Caribe', error: null }) });
  let res = respuesta();
  await cotizador(pedido({ accion: 'nombre', nombre: ' Plásticos  del Caribe ', id: ID }), res, { supabase: sb, entorno: ENTORNO });
  assert.deepEqual(res.cuerpo, { disponible: false, mensaje: mensajeNombreRepetido('Plásticos del Caribe') });
  assert.deepEqual(llamada(sb, 'cotizador_nombre_disponible').args, { p_aliado: 'u-1', p_nombre: 'Plásticos del Caribe', p_excluir: ID });
  res = respuesta();
  await cotizador(pedido({ accion: 'nombre', nombre: 'Plásticos del Caribe 2' }), res, { supabase: sb, entorno: ENTORNO });
  assert.deepEqual(res.cuerpo, { disponible: true });
  res = respuesta();
  await cotizador(pedido({ accion: 'nombre', nombre: 'x' }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 422);
});

test('propuesta: la pone en la cola, devuelve los puntos y responde aunque Clientify no esté configurado', async () => {
  const sb = supabaseFalso({ ...intentoOk, cotizador_solicitar_propuesta: { data: { estado: 'pendiente', puntos: 5 }, error: null } });
  const res = respuesta();
  await cotizador(pedido({ accion: 'propuesta', segmento: 'industrial', id: ID, correo_referente: 'ignorado@correo.test' }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.cuerpo, { ok: true, clientify: 'pendiente', puntos: 5 });
  assert.deepEqual(llamada(sb, 'cotizador_solicitar_propuesta').args, { p_aliado: 'u-1', p_segmento: 'industrial', p_id: ID });
});

test('propuesta: simulación vencida o datos inválidos', async () => {
  const sb = supabaseFalso({ ...intentoOk, cotizador_solicitar_propuesta: { data: null, error: { message: 'simulacion_inexistente: la simulación no existe o ya venció' } } });
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

const RESPUESTAS = {
  necesidad: { o: 'factura' }, resultado: { o: ['ahorro'] }, criterios: { o: ['precio', 'otro'], otro: ' Marca  local ' },
  autoridad: { o: 'gerencia' }, pendientes: { o: ['visita', 'numeros'] }, cuando: { o: '1_3' }, competencia: { o: 'no_se' }
};

test('meddpicc: valida y guarda las respuestas con la cotización', async () => {
  const sb = supabaseFalso(intentoOk);
  const res = respuesta();
  await cotizador(pedido({ accion: 'meddpicc', segmento: 'comercial', id: ID, respuestas: RESPUESTAS }), res, { supabase: sb, entorno: ENTORNO });
  assert.equal(res.statusCode, 200);
  const { args } = llamada(sb, 'cotizador_guardar_meddpicc');
  assert.equal(args.p_aliado, 'u-1');
  assert.equal(args.p_respuestas.v, 1);
  assert.deepEqual(args.p_respuestas.respuestas.criterios, { o: ['precio', 'otro'], otro: 'Marca local' });
  assert.deepEqual(args.p_respuestas.respuestas.necesidad, { o: ['factura'] });
});

test('meddpicc: incompleta o inválida → 422 sin guardar', async () => {
  const sb = supabaseFalso(intentoOk);
  for (const r of [{ ...RESPUESTAS, cuando: undefined }, { ...RESPUESTAS, autoridad: { o: 'gerencia' } }]) {
    const res = respuesta();
    const segmento = r.cuando ? 'residencial' : 'industrial'; // en residencial «Gerencia general» no existe
    await cotizador(pedido({ accion: 'meddpicc', segmento, id: ID, respuestas: r }), res, { supabase: sb, entorno: ENTORNO });
    assert.equal(res.statusCode, 422);
  }
  assert.ok(!llamada(sb, 'cotizador_guardar_meddpicc'));
});

test('mis_cotizaciones: solo las del aliado de la sesión; no cuenta como intento', async () => {
  const lista = [{ id: ID, segmento: 'industrial', nombre: 'Plásticos del Caribe', potencia_kwp: 110.7 }];
  const sb = supabaseFalso({ cotizador_mis_cotizaciones: ({ p_aliado }) => ({ data: p_aliado === 'u-1' ? lista : [], error: null }) });
  const res = respuesta();
  await cotizador(pedido({ accion: 'mis_cotizaciones', aliado: 'u-9' }), res, { supabase: sb, entorno: ENTORNO });
  assert.deepEqual(res.cuerpo, { cotizaciones: lista });
  assert.ok(!llamada(sb, 'cotizador_intento'));
});
