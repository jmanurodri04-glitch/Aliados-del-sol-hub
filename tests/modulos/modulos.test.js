// Tests de POST /api/modulos (CLAUDE.md §5.3) con un cliente de Supabase simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { errorDeModulo } from '../../api/modulos/index.js';

const ALIADO = { id: 'a0000000-0000-0000-0000-000000000001', codigo_aliado: 'EMPA23456789', estado: 'activo' };

function respuesta() {
  return {
    statusCode: 0, cuerpo: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.cuerpo = d; return this; }
  };
}

// Cliente mínimo: getUser, lectura de aliados y rpc('completar_modulo').
function supabaseFalso({ aliado = ALIADO, rpc = null, rpcError = null } = {}) {
  const llamadas = [];
  return {
    llamadas,
    auth: { getUser: async (t) => (t === 'token-valido' ? { data: { user: { id: aliado.id } }, error: null } : { data: null, error: { message: 'jwt' } }) },
    from: () => ({
      select: (cols) => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: cols.startsWith('id,') ? aliado : { puntos_disponibles: 45, puntos_nivel: 45, nivel: 'kilo' },
            error: null
          })
        })
      })
    }),
    rpc: async (nombre, args) => {
      llamadas.push({ nombre, args });
      return { data: rpc, error: rpcError };
    }
  };
}

const pedido = (cuerpo, token = 'token-valido') => ({ method: 'POST', headers: { authorization: 'Bearer ' + token }, body: cuerpo });

test('registra el módulo con el aliado de la sesión, nunca con uno del cuerpo', async () => {
  const sb = supabaseFalso({ rpc: { codigo: 'c11', nuevo: true, puntos: 5, recompensa_estado: 'otorgada' } });
  const res = respuesta();
  await handler(pedido({ codigo: 'C11', aliado_id: 'otro' }), res, sb);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sb.llamadas, [{ nombre: 'completar_modulo', args: { p_aliado: ALIADO.id, p_codigo: 'c11' } }]);
  assert.deepEqual(res.cuerpo, { codigo: 'c11', nuevo: true, puntos: 5, recompensa_estado: 'otorgada', puntos_disponibles: 45, puntos_nivel: 45, nivel: 'kilo' });
});

test('rechaza un código con formato inválido sin llamar a la base', async () => {
  const sb = supabaseFalso();
  const res = respuesta();
  await handler(pedido({ codigo: "c11'; drop" }), res, sb);
  assert.equal(res.statusCode, 400);
  assert.equal(sb.llamadas.length, 0);
});

test('sin sesión responde 401', async () => {
  const res = respuesta();
  await handler({ method: 'POST', headers: {}, body: { codigo: 'c11' } }, res, supabaseFalso());
  assert.equal(res.statusCode, 401);
});

test('una cuenta no activa responde 403', async () => {
  const res = respuesta();
  await handler(pedido({ codigo: 'c11' }), res, supabaseFalso({ aliado: { ...ALIADO, estado: 'suspendido' } }));
  assert.equal(res.statusCode, 403);
});

test('un módulo inexistente responde 404', async () => {
  const res = respuesta();
  await handler(pedido({ codigo: 'zz9' }), res,
    supabaseFalso({ rpcError: { message: 'modulo_inexistente: el módulo no existe o no está disponible' } }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.cuerpo.error, 'Este curso no está disponible.');
});

test('solo acepta POST', async () => {
  const res = respuesta();
  await handler({ method: 'GET', headers: {} }, res, supabaseFalso());
  assert.equal(res.statusCode, 405);
});

test('traduce los errores con prefijo estable y deja pasar los demás', () => {
  assert.equal(errorDeModulo('aliado_no_activo: la cuenta no está activa').status, 403);
  assert.equal(errorDeModulo('otro error'), null);
});
