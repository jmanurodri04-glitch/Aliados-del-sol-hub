// Sesión del aliado en las funciones de servidor (CLAUDE.md §3, §7.2, §10).
// El aliado SIEMPRE se toma del token de sesión (Authorization: Bearer <access_token de Supabase>),
// nunca de un campo enviado por el navegador. Solo las cuentas `activo` pueden usar /api.

export class ErrorHttp extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

export async function aliadoDeLaSesion(req, supabase) {
  const coincidencia = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/);
  if (!coincidencia) throw new ErrorHttp(401, 'Inicia sesión para continuar.');

  const { data, error } = await supabase.auth.getUser(coincidencia[1]);
  if (error || !data || !data.user) throw new ErrorHttp(401, 'Tu sesión expiró. Vuelve a iniciar sesión.');

  const { data: aliado, error: errorAliado } = await supabase
    .from('aliados').select('id, codigo_aliado, estado, rol').eq('id', data.user.id).maybeSingle();
  if (errorAliado) throw new ErrorHttp(500, 'No pudimos verificar tu cuenta. Intenta de nuevo.');
  if (!aliado) throw new ErrorHttp(403, 'Tu usuario no tiene un perfil de aliado.');
  if (aliado.estado !== 'activo') throw new ErrorHttp(403, 'Tu cuenta no está activa.');
  return aliado;
}

/** Admin de la sesión (CLAUDE.md §10): cuenta activa con rol = 'admin'. Las funciones de la base lo vuelven a verificar. */
export async function adminDeLaSesion(req, supabase) {
  const aliado = await aliadoDeLaSesion(req, supabase);
  if (aliado.rol !== 'admin') throw new ErrorHttp(403, 'Esta sección es solo para el equipo GEENERA.');
  return aliado;
}

/** Vercel entrega el cuerpo JSON ya interpretado; en otros entornos puede llegar como texto. */
export function cuerpoJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { throw new ErrorHttp(400, 'Solicitud inválida.'); }
}

export function responderError(res, e) {
  if (e instanceof ErrorHttp) return res.status(e.status).json({ error: e.message });
  console.error('Error inesperado:', e && e.name);
  return res.status(500).json({ error: 'No pudimos completar la operación. Intenta de nuevo en unos minutos.' });
}
