// GET /api/config — configuración pública de Supabase según el entorno (CLAUDE.md §1).
// Production apunta a aliados-prod; Preview y Development, a aliados-dev.
// Solo expone la URL y la publishable key: la seguridad la da RLS. Nunca la secret key.
// También la site key del captcha del formulario público (Cloudflare Turnstile), que es pública por diseño;
// su clave secreta (TURNSTILE_SECRET_KEY) solo la usa el servidor.

import { urlDeSupabase } from '../lib/supabase-servidor.js';

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const supabaseUrl = urlDeSupabase(process.env.SUPABASE_URL);
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return res.status(500).json({ error: 'Falta configurar SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY' });
  }

  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  return res.status(200).json({ supabaseUrl, supabasePublishableKey, turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null });
}
