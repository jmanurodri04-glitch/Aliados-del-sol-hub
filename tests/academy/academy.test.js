// Tests de la Academy administrable (CLAUDE.md §4.9): acciones del panel en /api/admin, formulario del curso y el
// endpoint de módulos con los códigos largos de los minicursos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import admin from '../../api/admin/index.js';
import modulos from '../../api/modulos/index.js';
import { codigoDe, datosDelCurso, modeloDelCurso } from '../../js/admin-academy.js';

const ADMIN = { id: 'a0000000-0000-0000-0000-00000000000a', codigo_aliado: 'EMZA23456789', estado: 'activo', rol: 'admin' };
function supabaseAdmin(respuestas = {}) {
  const llamadas = [];
  const borrados = [];
  const firmadas = [];
  return {
    llamadas, borrados, firmadas,
    auth: { getUser: async () => ({ data: { user: { id: ADMIN.id } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ADMIN, error: null }) }) }) }),
    rpc: async (nombre, args) => { llamadas.push({ nombre, args }); return respuestas[nombre] || { data: { ok: true }, error: null }; },
    storage: { from: (b) => ({
      createSignedUploadUrl: async (ruta) => { firmadas.push({ b, ruta }); return { data: { token: 'tok' }, error: null }; },
      remove: async (rutas) => { borrados.push({ b, rutas }); return { data: {}, error: null }; }
    }) }
  };
}
const respuesta = () => ({ statusCode: 0, cuerpo: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; }, json(d) { this.cuerpo = d; return this; } });
const pedido = (cuerpo) => ({ method: 'POST', headers: { authorization: 'Bearer token' }, body: cuerpo });

test('panel: guardar un curso y una certificación pasa los datos con el admin de la sesión', async () => {
  const sb = supabaseAdmin();
  const datos = { nuevo: true, codigo: 'curso-x', titulo: 'Curso X' };
  await admin(pedido({ accion: 'guardar_curso', datos, p_admin: 'otro' }), respuesta(), sb);
  await admin(pedido({ accion: 'guardar_certificacion', datos: { codigo: 'cert-x' } }), respuesta(), sb);
  assert.deepEqual(sb.llamadas, [
    { nombre: 'admin_guardar_curso', args: { p_admin: ADMIN.id, p_datos: datos } },
    { nombre: 'admin_guardar_certificacion', args: { p_admin: ADMIN.id, p_datos: { codigo: 'cert-x' } } }
  ]);
  const res = respuesta();
  await admin(pedido({ accion: 'guardar_curso' }), res, sb);
  assert.equal(res.statusCode, 400, 'sin datos no llama a la base');
});

test('panel: errores de la Academy con su código HTTP', async () => {
  for (const [mensaje, status] of [['curso_inexistente: el curso no existe', 404], ['dato_invalido: elige la escuela', 422],
    ['estado_invalido: ya existe un curso con ese código', 409]]) {
    const sb = supabaseAdmin({ admin_guardar_curso: { data: null, error: { message: mensaje } } });
    const res = respuesta();
    await admin(pedido({ accion: 'guardar_curso', datos: { codigo: 'x' } }), res, sb);
    assert.equal(res.statusCode, status, mensaje);
  }
});

test('panel: archivo de herramienta con URL firmada en academy/herramientas y borrado del anterior', async () => {
  const sb = supabaseAdmin({ admin_guardar_herramienta: { data: { codigo: 't-x', archivo_anterior: 'herramientas/viejo.pdf' }, error: null } });
  const res = respuesta();
  await admin(pedido({ accion: 'subir_archivo_herramienta', tipo: 'application/pdf', tamano: 1000 }), res, sb);
  assert.equal(res.statusCode, 200);
  assert.match(res.cuerpo.ruta, /^herramientas\/[0-9a-f-]{36}\.pdf$/);
  assert.equal(sb.firmadas[0].b, 'academy');
  for (const [tipo, tamano] of [['image/png', 1000], ['application/pdf', 11 * 1024 * 1024]]) {
    const r2 = respuesta();
    await admin(pedido({ accion: 'subir_archivo_herramienta', tipo, tamano }), r2, sb);
    assert.equal(r2.statusCode, 422, tipo + ' ' + tamano);
  }
  const r3 = respuesta();
  await admin(pedido({ accion: 'guardar_herramienta', datos: { codigo: 't-x' } }), r3, sb);
  assert.equal(r3.statusCode, 200);
  assert.deepEqual(sb.borrados, [{ b: 'academy', rutas: ['herramientas/viejo.pdf'] }]);
});

test('formulario: código desde el título y datos limpios para la base', () => {
  assert.equal(codigoDe('Cómo leer una Factura — Energía Ñ'), 'como-leer-una-factura-energia-n');
  const m = modeloDelCurso(null);
  Object.assign(m, { codigo: 'curso-x', titulo: ' Curso X ', descripcion: 'Corta', herramienta: 't-perfecto', aprenderas: 'Uno\n\n Dos ',
    contexto: 'Ctx', ejercicio: 'Ej', pasos: 'Paso 1\n', accion: 'Hazlo', aliados: [] });
  m.lecciones = [{ titulo: 'L1', texto: 'T1' }, { titulo: '', texto: '' }];
  m.quiz = [{ pregunta: '¿Q?', opciones: ['A', '', 'C', ''], correcta: 2 }];
  const d = datosDelCurso(m, true);
  assert.equal(d.titulo, 'Curso X');
  assert.deepEqual(d.aliados, ['todos'], 'sin elegir: para todos');
  assert.deepEqual(d.contenido.aprenderas, ['Uno', 'Dos']);
  assert.deepEqual(d.contenido.lecciones, [{ titulo: 'L1', texto: 'T1' }], 'sin microlecciones vacías');
  assert.deepEqual(d.contenido.quiz, [{ pregunta: '¿Q?', opciones: ['A', 'C'], correcta: 1 }], 'la correcta sigue a su opción al quitar las vacías');
  assert.equal(d.puntos, 5);
  assert.equal(datosDelCurso(Object.assign({}, m, { formato: 'masterclass', puntos: '10' }), true).puntos, 10, 'la masterclass vale +10');
  m.quiz[0].correcta = 1; // la opción marcada está vacía
  assert.equal(datosDelCurso(m, true).contenido.quiz[0].correcta, -1);
});

test('módulos: acepta los códigos largos de los minicursos', async () => {
  const llamadas = [];
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', estado: 'activo', rol: 'aliado', puntos_disponibles: 5, puntos_nivel: 5, nivel: 'kilo' }, error: null }) }) }) }),
    rpc: async (nombre, args) => { llamadas.push(args); return { data: { codigo: args.p_codigo, nuevo: true, puntos: 5, recompensa_estado: 'otorgada' }, error: null }; }
  };
  const codigo = 'conversaciones-empresariales-mas-alla-del-credito-y-algo-mas';
  const res = respuesta();
  await modulos(pedido({ codigo }), res, sb);
  assert.equal(res.statusCode, 200);
  assert.equal(llamadas[0].p_codigo, codigo);
});
