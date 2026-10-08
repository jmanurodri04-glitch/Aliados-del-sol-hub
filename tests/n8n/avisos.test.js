// Tests del aviso a n8n de los referidos imperfectos (CLAUDE.md §7.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirAviso, enviarAviso, motivoN8n, procesarAvisos, enviarAvisoAhora } from '../../lib/n8n/avisos.js';
import admin from '../../api/admin/index.js';

const fila = (extra = {}) => ({
  empresa_id: 'e0000000-0000-0000-0000-000000000001', empresa: 'Textiles Andinos', ciudad: 'Bucaramanga', subsector: null,
  cargo: '', tiene_factura: false, nombre_contacto: 'Laura Gómez', telefono: '+573105551234', correo: 'laura@cliente.test',
  canal: 'sesion', registrado_at: '2026-10-08T15:00:00Z', clientify_contact_id: '12345', codigo_aliado: 'EMLG23456789', intentos: 0,
  ...extra
});
const ENV = { N8N_IMPERFECTOS_URL: 'https://n8n.test/webhook/imperfectos', N8N_IMPERFECTOS_TOKEN: 'secreto-largo' };

test('aviso: datos que necesita el chatbot y lo que le falta al referido', () => {
  assert.deepEqual(construirAviso(fila(), { entorno: 'production' }), {
    evento: 'referido_imperfecto',
    referido_id: 'e0000000-0000-0000-0000-000000000001',
    registrado_at: '2026-10-08T15:00:00Z',
    entorno: 'production',
    canal: 'sesion',
    aliado: { codigo: 'EMLG23456789' },
    clientify_contact_id: '12345',
    empresa: 'Textiles Andinos',
    ciudad: 'Bucaramanga',
    contacto: { nombre: 'Laura Gómez', telefono: '+573105551234', correo: 'laura@cliente.test' },
    faltantes: ['Subsector', 'Cargo', 'Factura']
  });
  const completo = construirAviso(fila({ subsector: 'Textil', cargo: 'Gerente', ciudad: null, tiene_factura: true }));
  assert.deepEqual(completo.faltantes, ['Ciudad']);
  assert.equal(completo.entorno, 'development');
  assert.ok(!('aliado_id' in completo) && !('nombre' in completo.aliado), 'no lleva el id interno ni el nombre del aliado');
});

test('envío: POST JSON al webhook con el token en x-hub-token', async () => {
  let pedido;
  await enviarAviso({ url: ENV.N8N_IMPERFECTOS_URL, token: ENV.N8N_IMPERFECTOS_TOKEN, cuerpo: { a: 1 },
    fetchImpl: async (url, op) => { pedido = { url, ...op }; return { ok: true, status: 200 }; } });
  assert.equal(pedido.url, ENV.N8N_IMPERFECTOS_URL);
  assert.equal(pedido.method, 'POST');
  assert.equal(pedido.headers['x-hub-token'], 'secreto-largo');
  assert.equal(pedido.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(pedido.body), { a: 1 });
});

test('envío: motivos legibles para el panel', async () => {
  await assert.rejects(enviarAviso({ token: 't', cuerpo: {} }), /N8N_IMPERFECTOS_URL/);
  await assert.rejects(enviarAviso({ url: 'https://x', cuerpo: {} }), /N8N_IMPERFECTOS_TOKEN/);
  await assert.rejects(enviarAviso({ url: 'https://x', token: 't', cuerpo: {}, fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    /no se pudo conectar/);
  const tiempo = new Error('t'); tiempo.name = 'TimeoutError';
  await assert.rejects(enviarAviso({ url: 'https://x', token: 't', cuerpo: {}, fetchImpl: async () => { throw tiempo; } }), /a tiempo/);
  assert.match(motivoN8n(403), /token/);
  assert.match(motivoN8n(404), /no está activo/);
  assert.match(motivoN8n(429), /ejecuciones/);
  assert.match(motivoN8n(500), /se reintenta solo/);
});

function supabaseCola(lote) {
  const llamadas = [];
  return { llamadas, rpc: async (nombre, args) => { llamadas.push({ nombre, args }); return { data: nombre === 'avisos_n8n_reclamar' ? lote : null, error: null }; } };
}

test('cola: envía cada aviso y registra el resultado; un fallo guarda el motivo sin datos personales', async () => {
  const sb = supabaseCola([fila(), fila({ empresa_id: 'e0000000-0000-0000-0000-000000000002' })]);
  let n = 0;
  const r = await procesarAvisos({ supabase: sb, entorno: 'production', env: ENV,
    fetchImpl: async () => (++n === 1 ? { ok: true, status: 200 } : { ok: false, status: 500 }) });
  assert.equal(r.ok, 1);
  assert.equal(r.errores, 1);
  const resultados = sb.llamadas.filter((l) => l.nombre === 'avisos_n8n_resultado');
  assert.deepEqual(resultados[0].args, { p_empresa: 'e0000000-0000-0000-0000-000000000001', p_error: null });
  assert.match(resultados[1].args.p_error, /n8n 500/);
  assert.ok(!JSON.stringify(r).includes('laura@cliente.test') && !JSON.stringify(r).includes('+5731'), 'el resumen no lleva datos del contacto');
});

test('cola: sin la URL no llama a n8n y deja el motivo; el envío inmediato nunca falla', async () => {
  const sb = supabaseCola([fila()]);
  let llamado = false;
  await procesarAvisos({ supabase: sb, env: {}, fetchImpl: async () => { llamado = true; } });
  assert.equal(llamado, false);
  assert.match(sb.llamadas.find((l) => l.nombre === 'avisos_n8n_resultado').args.p_error, /N8N_IMPERFECTOS_URL/);

  const roto = { rpc: async () => ({ data: null, error: { message: 'caída' } }) };
  assert.equal(await enviarAvisoAhora(roto, 'e1', ENV), 'pendiente');
  assert.equal(await enviarAvisoAhora(supabaseCola([fila()]), 'e1', ENV, async () => ({ ok: true, status: 200 })), 'enviado');
  assert.equal(await enviarAvisoAhora(supabaseCola([]), 'e1', ENV, async () => ({ ok: true, status: 200 })), 'pendiente',
    'un perfecto o un referido que aún no está en Clientify no se envía');
});

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
      if (nombre === 'avisos_n8n_reclamar') return { data: lote, error: null };
      return { data: { ok: true }, error: null };
    }
  };
}
const respuesta = () => ({ statusCode: 0, cuerpo: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; }, json(d) { this.cuerpo = d; return this; } });
const pedido = (cuerpo) => ({ method: 'POST', headers: { authorization: 'Bearer token' }, body: cuerpo });

test('panel: reintentar un aviso lo vuelve a la cola y lo envía enseguida', async () => {
  const sb = supabaseAdmin([fila({ empresa_id: EMPRESA })]);
  const res = respuesta();
  await admin(pedido({ accion: 'reintentar_aviso_n8n', empresa_id: EMPRESA }), res, sb,
    { entorno: { ...ENV, VERCEL_ENV: 'production' }, fetch: async () => ({ ok: true, status: 200 }) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.cuerpo, { empresa_id: EMPRESA, enviado: true, error: null });
  assert.deepEqual(sb.llamadas.map((l) => l.nombre), ['admin_reintentar_aviso_n8n', 'avisos_n8n_reclamar', 'avisos_n8n_resultado']);
  assert.deepEqual(sb.llamadas[0].args, { p_admin: ADMIN.id, p_empresa: EMPRESA });

  const sb2 = supabaseAdmin([fila({ empresa_id: EMPRESA })]);
  const res2 = respuesta();
  await admin(pedido({ accion: 'reintentar_aviso_n8n', empresa_id: EMPRESA }), res2, sb2,
    { entorno: ENV, fetch: async () => ({ ok: false, status: 404 }) });
  assert.equal(res2.cuerpo.enviado, false);
  assert.match(res2.cuerpo.error, /no está activo/);

  const sb3 = supabaseAdmin();
  sb3.rpc = async () => ({ data: null, error: { message: 'estado_invalido: este aviso ya se envió' } });
  const res3 = respuesta();
  await admin(pedido({ accion: 'reintentar_aviso_n8n', empresa_id: EMPRESA }), res3, sb3, { entorno: ENV });
  assert.equal(res3.statusCode, 409);
});
