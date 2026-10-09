// Aviso a n8n de cada referido nuevo del Hub (CLAUDE.md §7.4). Lo usan /api/oportunidades (envío inmediato, cuando el
// referido acaba de llegar a Clientify), el cron /api/cron/clientify (reintentos y los que llegaron tarde a Clientify) y
// /api/admin (botón «Reintentar»).
// Cada tipo va a su propio webhook, protegido con el encabezado `x-hub-token`: los perfectos a N8N_PERFECTOS_URL
// (token N8N_PERFECTOS_TOKEN) y los imperfectos a N8N_IMPERFECTOS_URL (token N8N_IMPERFECTOS_TOKEN).
// En el resumen y en los errores solo va el codigo_aliado: nunca correos, teléfonos ni nombres (§10).

const ESPERA_MS = 10000;

/** Nombres de las variables de entorno del webhook de cada tipo. */
export function variablesDe(tipo) {
  const prefijo = tipo === 'perfecto' ? 'N8N_PERFECTOS' : 'N8N_IMPERFECTOS';
  return { url: prefijo + '_URL', token: prefijo + '_TOKEN' };
}

// Campos del referido perfecto que pueden faltar en un referido del Hub (los obligatorios siempre están, §4.4).
const vacio = (v) => v == null || String(v).trim() === '';

/** Cuerpo del aviso (función pura). */
export function construirAviso(fila, { entorno = 'development' } = {}) {
  const tipo = fila.tipo === 'perfecto' ? 'perfecto' : 'imperfecto';
  const faltantes = [];
  if (vacio(fila.subsector)) faltantes.push('Subsector');
  if (vacio(fila.ciudad)) faltantes.push('Ciudad');
  if (vacio(fila.cargo)) faltantes.push('Cargo');
  if (!fila.tiene_factura) faltantes.push('Factura');
  return {
    evento: 'referido_' + tipo,
    referido_id: fila.empresa_id,
    registrado_at: fila.registrado_at,
    entorno,
    canal: fila.canal || null,
    aliado: { codigo: fila.codigo_aliado },
    clientify_contact_id: fila.clientify_contact_id,
    empresa: fila.empresa,
    ciudad: fila.ciudad || null,
    contacto: { nombre: fila.nombre_contacto, telefono: fila.telefono, correo: fila.correo },
    faltantes
  };
}

/** Motivo legible de una respuesta fallida de n8n (sin datos personales). */
export function motivoN8n(status, variables = variablesDe('imperfecto')) {
  if (status === 401 || status === 403) return `n8n ${status}: el token no coincide (revisa ${variables.token} y el Header Auth del webhook)`;
  if (status === 404) return `n8n 404: el webhook no existe o el flujo no está activo (revisa ${variables.url})`;
  if (status === 429) return 'n8n 429: demasiadas llamadas o se acabaron las ejecuciones del plan (se reintenta solo)';
  if (status >= 500) return `n8n ${status}: error del flujo o del servidor de n8n (se reintenta solo)`;
  return `n8n respondió ${status}`;
}

/** Envía un aviso. Lanza un Error con el motivo si no se pudo. */
export async function enviarAviso({ url, token, cuerpo, fetchImpl = fetch, esperaMs = ESPERA_MS, variables = variablesDe('imperfecto') }) {
  if (!url) throw new Error(`Falta configurar ${variables.url} en Vercel`);
  if (!token) throw new Error(`Falta configurar ${variables.token} en Vercel`);
  let r;
  try {
    r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-token': token },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(esperaMs)
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Error('n8n no respondió a tiempo (se reintenta solo)');
    throw new Error('n8n: no se pudo conectar (se reintenta solo)');
  }
  if (!r.ok) throw new Error(motivoN8n(r.status, variables));
}

export async function procesarAvisos({ supabase, entorno = 'development', env = process.env, fetchImpl = fetch, limite = 10,
  empresaId = null, seguir = () => true }) {
  const resumen = { procesados: 0, ok: 0, errores: 0, pospuestos: 0, detalle: [] };
  const { data: lote, error } = await supabase.rpc('avisos_n8n_reclamar', { p_limite: limite, p_empresa: empresaId });
  if (error) throw new Error('No se pudo leer la cola de avisos a n8n (' + [error.code, error.message].filter(Boolean).join(': ').slice(0, 200) + ')');

  for (const fila of lote || []) {
    // Lo que no alcance a procesarse queda prestado 10 minutos y se toma en la siguiente ejecución.
    if (!seguir()) { resumen.pospuestos++; continue; }
    resumen.procesados++;
    let motivo = null;
    const tipo = fila.tipo === 'perfecto' ? 'perfecto' : 'imperfecto';
    try {
      const cuerpo = construirAviso(fila, { entorno });
      const variables = variablesDe(tipo);
      await enviarAviso({ url: env[variables.url], token: env[variables.token], cuerpo, fetchImpl, variables });
    } catch (e) {
      motivo = e.message || 'Error desconocido';
    }
    const { error: e } = await supabase.rpc('avisos_n8n_resultado', { p_empresa: fila.empresa_id, p_error: motivo });
    if (e && !motivo) motivo = 'Enviado, pero no se pudo registrar el resultado';
    if (motivo) { resumen.errores++; resumen.detalle.push({ codigo_aliado: fila.codigo_aliado, tipo, error: motivo }); }
    else { resumen.ok++; resumen.detalle.push({ codigo_aliado: fila.codigo_aliado, tipo, enviado: true }); }
  }
  return resumen;
}

/** Envío inmediato de una empresa (mejor esfuerzo): nunca hace fallar el registro del referido. */
export async function enviarAvisoAhora(supabase, empresaId, entorno, fetchImpl = fetch) {
  try {
    const r = await procesarAvisos({ supabase, entorno: entorno.VERCEL_ENV || 'development', env: entorno, fetchImpl, empresaId, limite: 1 });
    return r.ok === 1 ? 'enviado' : 'pendiente';
  } catch {
    return 'pendiente'; // queda en la cola
  }
}
