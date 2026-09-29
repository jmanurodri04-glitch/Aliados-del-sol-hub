// Tests de POST /api/admin y POST /api/eventos (CLAUDE.md §4.8, §10) con un cliente de Supabase simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import admin, { errorDeAdmin } from '../../api/admin/index.js';
import eventos, { errorDeEvento, nombreSeguro } from '../../api/eventos/index.js';

const ADMIN = { id: 'a0000000-0000-0000-0000-00000000000a', codigo_aliado: 'EMZA23456789', estado: 'activo', rol: 'admin' };
const ALIADO = { id: 'a0000000-0000-0000-0000-000000000001', codigo_aliado: 'EMAB23456789', estado: 'activo', rol: 'aliado' };
const CLAVE = 'b0000000-0000-0000-0000-000000000001';
const EVENTO = 'e0000000-0000-0000-0000-000000000001';

function respuesta() {
  return {
    statusCode: 0, cuerpo: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.cuerpo = d; return this; }
  };
}

function supabaseFalso({ usuario = ADMIN, rpc = { ok: true }, rpcError = null, evento = { registro_asistentes_path: 'x/y/a.pdf' } } = {}) {
  const llamadas = [];
  return {
    llamadas,
    auth: { getUser: async (t) => (t === 'token' ? { data: { user: { id: usuario.id } }, error: null } : { data: null, error: {} }) },
    from: (tabla) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tabla === 'aliados' ? usuario : evento, error: null }) }) })
    }),
    rpc: async (nombre, args) => { llamadas.push({ nombre, args }); return { data: rpc, error: rpcError }; },
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (ruta, seg) => { llamadas.push({ firmada: bucket, ruta, seg }); return { data: { signedUrl: 'https://firmada' }, error: null }; },
        createSignedUploadUrl: async (ruta) => { llamadas.push({ subida: bucket, ruta }); return { data: { path: ruta, token: 'tk' }, error: null }; }
      })
    }
  };
}
const pedido = (cuerpo) => ({ method: 'POST', headers: { authorization: 'Bearer token' }, body: cuerpo });

// /api/admin ---------------------------------------------------------------------------------------------------

test('admin: ejecuta la acción con el id del admin de la sesión, nunca con uno del cuerpo', async () => {
  const sb = supabaseFalso({ rpc: { codigo_aliado: 'EMAB23456789', estado: 'activo' } });
  const res = respuesta();
  await admin(pedido({ accion: 'aprobar', codigo: 'emab23456789', p_admin: 'otro' }), res, sb);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sb.llamadas, [{ nombre: 'admin_aprobar_aliado', args: { p_admin: ADMIN.id, p_codigo: 'emab23456789' } }]);
});

test('admin: un aliado sin rol admin recibe 403 y no llega a la base', async () => {
  const sb = supabaseFalso({ usuario: ALIADO });
  const res = respuesta();
  await admin(pedido({ accion: 'aprobar', codigo: 'EMAB23456789' }), res, sb);
  assert.equal(res.statusCode, 403);
  assert.equal(sb.llamadas.length, 0);
});

test('admin: ajuste exige clave e importe entero', async () => {
  const sb = supabaseFalso();
  let res = respuesta();
  await admin(pedido({ accion: 'ajuste', codigo: 'EMAB23456789', puntos: 10, nota: 'Corrección justificada' }), res, sb);
  assert.equal(res.statusCode, 400);
  res = respuesta();
  await admin(pedido({ accion: 'ajuste', codigo: 'EMAB23456789', puntos: 2.5, nota: 'Corrección justificada', clave: CLAVE }), res, sb);
  assert.equal(res.statusCode, 422);
  res = respuesta();
  await admin(pedido({ accion: 'ajuste', codigo: 'EMAB23456789', puntos: '-30', nota: 'Corrección justificada', clave: CLAVE }), res, sb);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sb.llamadas.at(-1).args, { p_admin: ADMIN.id, p_codigo: 'EMAB23456789', p_puntos: -30, p_nota: 'Corrección justificada', p_clave: CLAVE });
});

test('admin: resolver un conflicto sin ajuste no exige clave', async () => {
  const sb = supabaseFalso();
  const res = respuesta();
  await admin(pedido({ accion: 'resolver_conflicto', conflicto_id: CLAVE, nota: 'Revisado con comercial', aceptar_valor: true }), res, sb);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sb.llamadas[0].args, { p_admin: ADMIN.id, p_conflicto: CLAVE, p_nota: 'Revisado con comercial', p_aceptar_valor: true, p_ajuste: null, p_clave: null });
});

test('admin: traduce los errores de la base', async () => {
  const res = respuesta();
  await admin(pedido({ accion: 'validar_evento', evento_id: EVENTO }), res,
    supabaseFalso({ rpcError: { message: 'evento_incompleto: no hay registro de asistentes' } }));
  assert.equal(res.statusCode, 422);
  assert.equal(res.cuerpo.error, 'No hay registro de asistentes.');
  assert.equal(errorDeAdmin('estado_invalido: el evento ya fue revisado').status, 409);
  assert.equal(errorDeAdmin('otro'), null);
});

test('admin: archivo_evento devuelve una URL firmada de 5 minutos', async () => {
  const sb = supabaseFalso();
  const res = respuesta();
  await admin(pedido({ accion: 'archivo_evento', evento_id: EVENTO }), res, sb);
  assert.equal(res.statusCode, 200);
  assert.equal(res.cuerpo.url, 'https://firmada');
  assert.deepEqual(sb.llamadas[0], { firmada: 'eventos', ruta: 'x/y/a.pdf', seg: 300 });
});

test('admin: acción desconocida responde 400', async () => {
  const res = respuesta();
  await admin(pedido({ accion: 'borrar_todo' }), res, supabaseFalso());
  assert.equal(res.statusCode, 400);
});

// /api/eventos -----------------------------------------------------------------------------------------------

test('eventos: la subida queda en la carpeta del aliado de la sesión y de un evento nuevo', async () => {
  const sb = supabaseFalso({ usuario: ALIADO });
  const res = respuesta();
  await eventos(pedido({ accion: 'subir', nombre_archivo: 'Asistentes Cámara.xlsx', tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', tamano: 2048 }), res, sb);
  assert.equal(res.statusCode, 200);
  assert.match(res.cuerpo.ruta, new RegExp(`^${ALIADO.id}/[0-9a-f-]{36}/Asistentes-Camara\\.xlsx$`));
  assert.equal(res.cuerpo.ruta.split('/')[1], res.cuerpo.evento_id);
});

test('eventos: rechaza tipos y tamaños no permitidos', async () => {
  let res = respuesta();
  await eventos(pedido({ accion: 'subir', nombre_archivo: 'a.exe', tipo: 'application/x-msdownload', tamano: 10 }), res, supabaseFalso({ usuario: ALIADO }));
  assert.equal(res.statusCode, 422);
  res = respuesta();
  await eventos(pedido({ accion: 'subir', nombre_archivo: 'a.pdf', tipo: 'application/pdf', tamano: 11 * 1024 * 1024 }), res, supabaseFalso({ usuario: ALIADO }));
  assert.equal(res.statusCode, 422);
});

test('eventos: registrar usa el aliado de la sesión y solo acepta archivos de su carpeta', async () => {
  const sb = supabaseFalso({ usuario: ALIADO, rpc: { evento_id: EVENTO, estado: 'pendiente' } });
  let res = respuesta();
  await eventos(pedido({ accion: 'registrar', evento_id: EVENTO, datos: { nombre_evento: 'Taller', fecha: '2026-09-20', extra: 'x' }, archivo: 'otro/' + EVENTO + '/a.pdf' }), res, sb);
  assert.equal(res.statusCode, 422);
  assert.equal(sb.llamadas.length, 0);
  res = respuesta();
  await eventos(pedido({ accion: 'registrar', evento_id: EVENTO, datos: { nombre_evento: 'Taller', fecha: '2026-09-20', extra: 'x' } }), res, sb);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(sb.llamadas[0].args, { p_aliado: ALIADO.id, p_evento: EVENTO, p_datos: { nombre_evento: 'Taller', fecha: '2026-09-20' }, p_archivo: null });
});

test('eventos: traduce los errores de la base', () => {
  assert.equal(errorDeEvento('limite_eventos: máximo 5').status, 429);
  assert.equal(errorDeEvento('evento_invalido: la fecha debe ser la de un evento ya realizado').message, 'La fecha debe ser la de un evento ya realizado.');
  assert.equal(nombreSeguro('Lista final (v2).pdf', 'application/pdf'), 'Lista-final-v2.pdf');
});
