// Conciliación: una vez al día (02:00 Bogotá) incluye también los referidos cerrados (correcciones-hub).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horaBogota, incluirCerrados } from '../../api/cron/clientify-conciliacion.js';

test('la hora se calcula en Bogotá (UTC−5)', () => {
  assert.equal(horaBogota(new Date('2026-10-06T07:00:00Z')), 2);
  assert.equal(horaBogota(new Date('2026-10-06T04:30:00Z')), 23);
  assert.equal(horaBogota(new Date('2026-10-06T05:00:00Z')), 0);
});

test('incluye los cerrados en la corrida de las 02:00 (Vercel Cron) y de las 02:07 (pg_cron)', () => {
  assert.equal(incluirCerrados({}, new Date('2026-10-06T07:00:00Z')), true);
  assert.equal(incluirCerrados({ query: {} }, new Date('2026-10-06T07:07:00Z')), true);
});

test('las demás horas no los incluye, salvo que se pida con ?cerrados=1', () => {
  assert.equal(incluirCerrados({ query: {} }, new Date('2026-10-06T08:07:00Z')), false);
  assert.equal(incluirCerrados(undefined, new Date('2026-10-06T06:59:00Z')), false);
  assert.equal(incluirCerrados({ query: { cerrados: '1' } }, new Date('2026-10-06T15:07:00Z')), true);
  assert.equal(incluirCerrados({ query: { cerrados: 'si' } }, new Date('2026-10-06T15:07:00Z')), false);
});
