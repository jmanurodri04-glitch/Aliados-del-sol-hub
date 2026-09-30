// Tests de POST /api/canjes (CLAUDE.md §4.10, §10) con un cliente de Supabase simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import canjes, { errorDeCanje, leerApiKeys, proveedorDeLaKey } from '../../api/canjes/index.js';

const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);
const ENTORNO = { CANJES_API_KEYS: `Tienda-A:${KEY_A}, chatbot:${KEY_B}, corto:123, sinkey` };

function respuesta() {
  return {
    statusCode: 0, cuerpo: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.cuerpo = d; return this; }
  };
}
function supabaseFalso({ data = { duplicado: false }, error = null } = {}) {
  const llamadas = [];
  return { llamadas, rpc: async (nombre, args) => { llamadas.push({ nombre, args }); return { data, error }; } };
}
const pedido = (cuerpo, key = KEY_A) => ({ method: 'POST', headers: { authorization: 'Bearer ' + key }, body: cuerpo });

test('canjes: lee las keys por proveedor y descarta las mal formadas o cortas', () => {
  assert.deepEqual(leerApiKeys(ENTORNO.CANJES_API_KEYS), [{ proveedor: 'tienda-a', key: KEY_A }, { proveedor: 'chatbot', key: KEY_B }]);
  assert.deepEqual(leerApiKeys(''), []);
  assert.equal(proveedorDeLaKey('Bearer ' + KEY_B, leerApiKeys(ENTORNO.CANJES_API_KEYS)), 'chatbot');
  assert.equal(proveedorDeLaKey('Bearer ' + KEY_B + 'x', leerApiKeys(ENTORNO.CANJES_API_KEYS)), null);
  assert.equal(proveedorDeLaKey(KEY_B, leerApiKeys(ENTORNO.CANJES_API_KEYS)), null);
});

test('canjes: sin keys configuradas responde 503 y con una key inválida 401, sin llegar a la base', async () => {
  const sb = supabaseFalso();
  let res = respuesta();
  await canjes(pedido({ accion: 'consultar', codigo_aliado: 'EMAB23456789' }), res, sb, {});
  assert.equal(res.statusCode, 503);
  res = respuesta();
  await canjes(pedido({ accion: 'consultar', codigo_aliado: 'EMAB23456789' }, 'x'.repeat(32)), res, sb, ENTORNO);
  assert.equal(res.statusCode, 401);
  assert.equal(sb.llamadas.length, 0);
});

test('canjes: el proveedor sale de la key aunque el cuerpo diga otro', async () => {
  const sb = supabaseFalso({ data: { canje_id: 'x', duplicado: false } });
  const res = respuesta();
  await canjes(pedido({ accion: 'canjear', codigo_aliado: 'emab23456789', recompensa: 'Cafe', referencia_externa: ' R-1 ', proveedor: 'otro' }, KEY_B), res, sb, ENTORNO);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(sb.llamadas[0], { nombre: 'registrar_canje', args: { p_proveedor: 'chatbot', p_codigo: 'emab23456789', p_recompensa: 'cafe', p_referencia: 'R-1' } });
});

test('canjes: un canje repetido responde 200 con duplicado', async () => {
  const res = respuesta();
  await canjes(pedido({ accion: 'canjear', codigo_aliado: 'EMAB23456789', recompensa: 'cafe', referencia_externa: 'R-1' }), res,
    supabaseFalso({ data: { canje_id: 'x', duplicado: true } }), ENTORNO);
  assert.equal(res.statusCode, 200);
  assert.equal(res.cuerpo.duplicado, true);
});

test('canjes: consultar llama a consultar_canjes con el proveedor de la key', async () => {
  const sb = supabaseFalso({ data: { activo: true, recompensas: [] } });
  const res = respuesta();
  await canjes(pedido({ accion: 'consultar', codigo_aliado: 'EMAB23456789' }), res, sb, ENTORNO);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sb.llamadas[0], { nombre: 'consultar_canjes', args: { p_proveedor: 'tienda-a', p_codigo: 'EMAB23456789' } });
});

test('canjes: valida el cuerpo antes de llamar a la base', async () => {
  const sb = supabaseFalso();
  for (const cuerpo of [
    { accion: 'canjear', codigo_aliado: 'EMAB23456789', recompensa: 'cafe' },
    { accion: 'canjear', codigo_aliado: 'EMAB23456789', recompensa: 'café!', referencia_externa: 'R-1' },
    { accion: 'canjear', codigo_aliado: 'x', recompensa: 'cafe', referencia_externa: 'R-1' },
    { accion: 'consultar' }
  ]) {
    const res = respuesta();
    await canjes(pedido(cuerpo), res, sb, ENTORNO);
    assert.equal(res.statusCode, 422, JSON.stringify(cuerpo));
  }
  const res = respuesta();
  await canjes(pedido({ accion: 'borrar' }), res, sb, ENTORNO);
  assert.equal(res.statusCode, 400);
  assert.equal(sb.llamadas.length, 0);
});

test('canjes: traduce los errores de la base con un código estable', async () => {
  const res = respuesta();
  await canjes(pedido({ accion: 'canjear', codigo_aliado: 'EMAB23456789', recompensa: 'cena', referencia_externa: 'R-2' }), res,
    supabaseFalso({ error: { message: 'saldo_insuficiente: la recompensa vale 200 puntos y el saldo disponible es 180' } }), ENTORNO);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.cuerpo, { error: 'La recompensa vale 200 puntos y el saldo disponible es 180.', codigo: 'saldo_insuficiente' });
  assert.equal(errorDeCanje('limite_canjes: máximo 30 canjes por hora').status, 429);
  assert.equal(errorDeCanje('aliado_inexistente: no existe').status, 404);
  assert.equal(errorDeCanje('otro error'), null);
});

test('canjes: solo acepta POST', async () => {
  const res = respuesta();
  await canjes({ method: 'GET', headers: {} }, res, supabaseFalso(), ENTORNO);
  assert.equal(res.statusCode, 405);
});
