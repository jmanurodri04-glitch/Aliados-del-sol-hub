// GET /api/config: el id de Microsoft Clarity solo sale en Production (CLAUDE.md §10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../api/config.js';

const respuesta = () => ({ statusCode: 0, cuerpo: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; }, json(d) { this.cuerpo = d; return this; } });

function conEntorno(vars, fn) {
  const antes = {};
  for (const k of Object.keys(vars)) { antes[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k of Object.keys(antes)) { if (antes[k] == null) delete process.env[k]; else process.env[k] = antes[k]; } }
}

const BASE = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', CLARITY_PROJECT_ID: 'abc123xyz' };

test('config: Clarity solo en Production', () => {
  for (const [entorno, esperado] of [['production', 'abc123xyz'], ['preview', null], ['development', null], [null, null]]) {
    const res = respuesta();
    conEntorno({ ...BASE, VERCEL_ENV: entorno }, () => config({ method: 'GET' }, res));
    assert.equal(res.statusCode, 200);
    assert.equal(res.cuerpo.clarityProjectId, esperado, String(entorno));
  }
  const res = respuesta();
  conEntorno({ ...BASE, VERCEL_ENV: 'production', CLARITY_PROJECT_ID: null }, () => config({ method: 'GET' }, res));
  assert.equal(res.cuerpo.clarityProjectId, null, 'sin la variable no se carga');
});
