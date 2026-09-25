// Cliente de Supabase para las funciones de servidor (/api). Usa SUPABASE_SECRET_KEY, que ignora RLS:
// nunca se importa desde el navegador ni se expone en /api/config (CLAUDE.md §10).

import { createClient } from '@supabase/supabase-js';

export function crearClienteServidor() {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !clave) throw new Error('Falta configurar SUPABASE_URL o SUPABASE_SECRET_KEY');
  return createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
}
