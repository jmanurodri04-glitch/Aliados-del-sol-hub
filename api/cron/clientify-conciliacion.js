// GET|POST /api/cron/clientify-conciliacion — conciliación nocturna (CLAUDE.md §8, flujo C).
// Vuelve a encolar los referidos en curso (por si se perdió algún webhook), escanea las oportunidades
// y procesa las colas.
// Lo llaman pg_cron cada hora (minuto 7) y Vercel Cron a las 02:00 Bogotá; lo que no alcance a procesarse lo toma
// el job de cada 2 minutos. Una vez al día (la hora 2 de Bogotá) también vuelve a leer los referidos cerrados, por si
// les cambiaron solo el contacto (etiqueta de información falsa o retroceso de Status). `?cerrados=1` lo fuerza.

import { contextoClientify, procesarColas, validarCron } from '../../lib/cron.js';
import { escanearOportunidades } from '../../lib/clientify/cola.js';

const HORA_CERRADOS = 2; // hora de Bogotá en la que la conciliación incluye los referidos cerrados

/** Hora (0–23) de Bogotá en la fecha dada. */
export function horaBogota(fecha = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hourCycle: 'h23' }).format(fecha));
}

/** ¿Esta corrida debe incluir los referidos cerrados? */
export function incluirCerrados(req, fecha = new Date()) {
  return req?.query?.cerrados === '1' || horaBogota(fecha) === HORA_CERRADOS;
}

export default async function handler(req, res) {
  if (!validarCron(req, res)) return;
  let contexto;
  try {
    contexto = contextoClientify({ presupuestoMs: 45000 });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  try {
    const cerrados = incluirCerrados(req);
    const { data: encolados, error } = await contexto.supabase.rpc('clientify_encolar_conciliacion', { p_incluir_cerrados: cerrados });
    if (error) throw new Error('No se pudo encolar la conciliación (' + [error.code, error.message].filter(Boolean).join(': ') + ')');
    const escaneo = await escanearOportunidades(contexto);
    return res.status(200).json({ encolados, cerrados, escaneo, ...(await procesarColas(contexto)) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
