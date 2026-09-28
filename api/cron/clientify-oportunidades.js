// GET|POST /api/cron/clientify-oportunidades — escaneo de oportunidades (CLAUDE.md §8, flujo C).
// La API de Clientify no filtra oportunidades por contacto, y el webhook de oportunidades puede no estar
// disponible: cada hora se revisan las oportunidades de los embudos del programa, se encolan las de referidos
// que cambiaron y se procesan las colas. Lo llama pg_cron (job escanear-oportunidades-clientify).

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
    const escaneo = await escanearOportunidades(contexto);
    return res.status(200).json({ escaneo, ...(await procesarColas(contexto)) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
