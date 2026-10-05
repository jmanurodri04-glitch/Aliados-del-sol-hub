// Diagnóstico de Clientify: búsqueda del campo "Tipo" con el valor "Aliados Estratégicos" (correcciones-hub).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumenSondeo, rutasConValor } from '../../api/cron/clientify-diagnostico.js';
import { crearClienteClientify } from '../../lib/clientify/cliente.js';

test('encuentra el valor en una clave nativa, sin distinguir tildes ni mayúsculas', () => {
  assert.deepEqual(rutasConValor({ id: 1, contact_type: 'Aliados Estratégicos' }), ['contact_type']);
  assert.deepEqual(rutasConValor({ tipo: ' aliados estrategicos ' }), ['tipo']);
});

test('nombra los campos personalizados por su campo y recorre objetos anidados', () => {
  const ficha = {
    custom_fields: [{ id: 9, field: 'Regional', value: 'Oriente' }, { id: 7, field: 'Tipo', value: 'Aliados Estratégicos' }],
    tipo: { id: 3, name: 'Aliados Estratégicos' }
  };
  assert.deepEqual(rutasConValor(ficha).sort(), ['custom_fields[field=Tipo].value', 'tipo.name']);
});

test('no encuentra nada si el valor no está', () => {
  assert.deepEqual(rutasConValor({ status: 'hot-lead', tags: ['aliados del sol'], medium: null }), []);
});

test('sondeo de archivos: resume código, métodos, error y campos de OPTIONS sin valores', () => {
  const opciones = resumenSondeo({ status: 200, allow: 'GET, POST, HEAD, OPTIONS', cuerpo: {
    name: 'Company File List', actions: { POST: { file: { type: 'file upload', required: true }, company: { type: 'field', required: false, read_only: true } } } } });
  assert.deepEqual(opciones, { status: 200, allow: 'GET, POST, HEAD, OPTIONS',
    acciones: { POST: { file: { tipo: 'file upload', requerido: true, solo_lectura: false }, company: { tipo: 'field', requerido: false, solo_lectura: true } } } });
  assert.deepEqual(resumenSondeo({ status: 403, allow: null, cuerpo: { detail: 'You do not have permission to perform this action.' } }),
    { status: 403, allow: null, detalle: 'You do not have permission to perform this action.' });
  const lista = resumenSondeo({ status: 200, allow: null, cuerpo: { count: 1, results: [{ id: 5, name: 'factura.pdf', file: 'https://x/secreto.pdf' }] } });
  assert.equal(lista.count, 1);
  assert.deepEqual(lista.estructura_item, { id: 'number', name: 'string', file: 'string' }, 'solo tipos, nunca valores');
  assert.deepEqual(resumenSondeo({ status: null, error: 'TimeoutError' }), { status: null, allow: null, error: 'TimeoutError' });
});

test('cliente: sondear solo permite GET y OPTIONS y no lanza ante un 403', async () => {
  const llamadas = [];
  const c = crearClienteClientify({ apiKey: 'k', fetchImpl: async (url, o) => { llamadas.push(o.method); return { status: 403, headers: { get: () => 'GET, OPTIONS' }, text: async () => '{"detail":"no"}' }; } });
  assert.deepEqual(await c.sondear('OPTIONS', '/companies/1/files/'), { status: 403, allow: 'GET, OPTIONS', cuerpo: { detail: 'no' } });
  await assert.rejects(c.sondear('POST', '/companies/1/files/'));
  assert.deepEqual(llamadas, ['OPTIONS']);
});
