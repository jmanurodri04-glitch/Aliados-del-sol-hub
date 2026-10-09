// Cola del correo «Confirmación de empresa referida» (CLAUDE.md §7). La usan /api/oportunidades (envío inmediato de
// la empresa recién referida), el cron /api/cron/clientify (reintentos) y /api/admin (botón «Reintentar»).
// En el resumen solo va el codigo_aliado: nunca correos, nombres ni ids internos de aliados (§2, §10).

import { construirConfirmacion } from './confirmacion.js';
import { enviarConResend } from './resend.js';

export async function procesarCorreos({ supabase, entorno = 'development', env = process.env, fetchImpl = fetch, limite = 10,
  empresaId = null, seguir = () => true }) {
  const resumen = { procesados: 0, ok: 0, errores: 0, pospuestos: 0, detalle: [] };
  const { data: lote, error } = await supabase.rpc('correos_referido_reclamar', { p_limite: limite, p_empresa: empresaId });
  if (error) throw new Error('No se pudo leer la cola de correos (' + [error.code, error.message].filter(Boolean).join(': ').slice(0, 200) + ')');

  for (const fila of lote || []) {
    // Lo que no alcance a procesarse queda prestado 10 minutos y se toma en la siguiente ejecución.
    if (!seguir()) { resumen.pospuestos++; continue; }
    resumen.procesados++;
    let motivo = null;
    try {
      const correo = construirConfirmacion(fila, { entorno });
      await enviarConResend({
        apiKey: env.RESEND_API_KEY, fetchImpl, de: env.RESEND_FROM || undefined, para: fila.correo_aliado,
        asunto: correo.asunto, html: correo.html, texto: correo.texto, responderA: correo.responderA,
        idempotencia: `confirmacion-referido/${fila.empresa_id}`
      });
    } catch (e) {
      motivo = e.message || 'Error desconocido';
    }
    const { error: e } = await supabase.rpc('correos_referido_resultado', { p_empresa: fila.empresa_id, p_error: motivo });
    if (e && !motivo) motivo = 'Enviado, pero no se pudo registrar el resultado';
    if (motivo) { resumen.errores++; resumen.detalle.push({ codigo_aliado: fila.codigo_aliado, error: motivo }); }
    else { resumen.ok++; resumen.detalle.push({ codigo_aliado: fila.codigo_aliado, enviado: true }); }
  }
  return resumen;
}

/** Envío inmediato de una empresa (mejor esfuerzo): nunca hace fallar el registro del referido. */
export async function enviarCorreoAhora(supabase, empresaId, entorno, fetchImpl = fetch) {
  try {
    const r = await procesarCorreos({ supabase, entorno: entorno.VERCEL_ENV || 'development', env: entorno, fetchImpl, empresaId, limite: 1 });
    return r.ok === 1 ? 'enviado' : 'pendiente';
  } catch {
    return 'pendiente'; // queda en la cola
  }
}
