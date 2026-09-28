// Cliente de Supabase para las funciones de servidor (/api). Usa SUPABASE_SECRET_KEY, que ignora RLS:
// nunca se importa desde el navegador ni se expone en /api/config (CLAUDE.md §10).

import { createClient } from '@supabase/supabase-js';

/**
 * URL base del proyecto (https://<ref>.supabase.co). Tolera que la variable se haya copiado con una ruta
 * de la API (/rest/v1, /auth/v1…) o con "/" al final, que harían fallar todas las llamadas con 404.
 */
export function urlDeSupabase(valor) {
  const url = String(valor || '').trim().replace(/\/+$/, '');
  return url.replace(/\/(rest|auth|storage|realtime|functions)\/v1$/, '');
}

export function crearClienteServidor() {
  const url = urlDeSupabase(process.env.SUPABASE_URL);
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !clave) throw new Error('Falta configurar SUPABASE_URL o SUPABASE_SECRET_KEY');
  return createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
}
