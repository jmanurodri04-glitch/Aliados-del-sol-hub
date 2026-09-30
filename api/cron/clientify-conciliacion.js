// GET|POST /api/cron/clientify-conciliacion — conciliación nocturna (CLAUDE.md §8, flujo C).
// Vuelve a encolar los referidos en curso (por si se perdió algún webhook), escanea las oportunidades
// y procesa las colas.
// Lo llama Vercel Cron a las 02:00 Bogotá; lo que no alcance a procesarse lo toma el job de cada 2 minutos.

import { contextoClientify, procesarColas, validarCron } from '../../lib/cron.js';
import { escanearOportunidades } from '../../lib/clientify/cola.js';

export default async function handler(req, res) {
  if (!validarCron(req, res)) return;
  let contexto;
  try {
    contexto = contextoClientify({ presupuestoMs: 45000 });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  try {
    const { data: encolados, error } = await contexto.supabase.rpc('clientify_encolar_conciliacion');
    if (error) throw new Error('No se pudo encolar la conciliación (' + [error.code, error.message].filter(Boolean).join(': ') + ')');
    const escaneo = await escanearOportunidades(contexto);
    return res.status(200).json({ encolados, escaneo, ...(await procesarColas(contexto)) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
