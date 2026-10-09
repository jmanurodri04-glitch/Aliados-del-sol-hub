// Envío de correos con la API de Resend (https://resend.com/docs/api-reference/emails/send-email).
// La key va en RESEND_API_KEY (Vercel, solo con permiso de envío); nunca en el código ni en el navegador.
// Los errores se traducen a un motivo corto en español, sin datos personales, para mostrarlo en el panel.

export const REMITENTE = 'Aliados del Sol · GEENERA <no-reply@notificaciones.geenera.com>';
const URL_RESEND = 'https://api.resend.com/emails';

// Quita direcciones de correo de un mensaje de error (no se guardan datos personales).
const sinCorreos = (s) => String(s || '').replace(/[^\s<>"'`]+@[^\s<>"'`]+/g, '[correo]');

/** Motivo legible de una respuesta fallida de Resend. */
export function motivoResend(status, cuerpo = {}) {
  const nombre = String(cuerpo.name || '');
  const mensaje = sinCorreos(cuerpo.message).slice(0, 160);
  if (status === 429) {
    if (nombre === 'daily_quota_exceeded') return 'Resend: se alcanzó el límite diario de envíos (se reintenta solo)';
    if (nombre === 'monthly_quota_exceeded') return 'Resend: se alcanzó el límite mensual de envíos; revisa el plan de Resend';
    return 'Resend: demasiados envíos seguidos (se reintenta solo)';
  }
  if (status === 401 || nombre === 'missing_api_key' || nombre === 'invalid_api_key') return 'Resend: la API key no es válida (revisa RESEND_API_KEY)';
  if (status === 403) return `Resend: sin permiso para enviar (${mensaje || 'revisa la key y el dominio verificado'})`;
  if (status === 422 || status === 400) return `Resend: datos del correo rechazados (${mensaje || nombre || status})`;
  return `Resend ${status}: ${mensaje || nombre || 'error desconocido'}`;
}

/**
 * Envía un correo. Lanza un Error con el motivo si no se pudo.
 * `idempotencia` evita un segundo envío si se repite la misma llamada (Resend la recuerda 24 h).
 */
export async function enviarConResend({ apiKey, fetchImpl = fetch, de = REMITENTE, para, asunto, html, texto, responderA, idempotencia }) {
  if (!apiKey) throw new Error('Falta configurar RESEND_API_KEY en Vercel');
  let r;
  try {
    r = await fetchImpl(URL_RESEND, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...(idempotencia ? { 'idempotency-key': idempotencia } : {})
      },
      body: JSON.stringify({ from: de, to: [para], subject: asunto, html, text: texto, ...(responderA ? { reply_to: responderA } : {}) })
    });
  } catch {
    throw new Error('Resend: no se pudo conectar (se reintenta solo)');
  }
  let cuerpo = {};
  try { cuerpo = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new Error(motivoResend(r.status, cuerpo));
  return { id: cuerpo.id || null };
}
