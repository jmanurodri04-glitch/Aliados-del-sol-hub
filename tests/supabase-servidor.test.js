// La URL de Supabase se normaliza: una variable copiada con /rest/v1 o "/" al final no debe romper las llamadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlDeSupabase } from '../lib/supabase-servidor.js';

test('deja solo la URL base del proyecto', () => {
  const base = 'https://abcdefghijklmnop.supabase.co';
  for (const valor of [base, base + '/', base + '/rest/v1', base + '/rest/v1/', ` ${base}/auth/v1 `, base + '/storage/v1']) {
    assert.equal(urlDeSupabase(valor), base, valor);
  }
  assert.equal(urlDeSupabase('http://127.0.0.1:54321'), 'http://127.0.0.1:54321');
  assert.equal(urlDeSupabase(undefined), '');
});
