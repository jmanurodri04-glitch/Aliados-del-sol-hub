// GET|POST /api/cron/clientify — procesa las colas de sincronización con Clientify (CLAUDE.md §8):
//   flujo A (aliados aprobados), flujo B (oportunidades del Hub) y flujo C (eventos del webhook).
// Es idempotente: se puede llamar cuantas veces se quiera. Protegido con `Authorization: Bearer <CRON_SECRET>`.
// Lo llama pg_cron cada 2 minutos (y la conciliación de Vercel Cron una vez al día).

import { contextoClientify, procesarColas, validarCron } from '../../lib/cron.js';

export default async function handler(req, res) {
  if (!validarCron(req, res)) return;
  let contexto;
  try {
    contexto = contextoClientify();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  try {
    return res.status(200).json(await procesarColas(contexto));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
