// Diagnóstico de Clientify: búsqueda del campo "Tipo" con el valor "Aliados Estratégicos" (correcciones-hub).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rutasConValor } from '../../api/cron/clientify-diagnostico.js';

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
