// POST /api/webhooks/clientify?token=<CLIENTIFY_WEBHOOK_SECRET> — webhook de Clientify (CLAUDE.md §8, flujo C).
//
// Solo valida el token, guarda el evento crudo y encola el contacto u oportunidad: responde 200 enseguida.
// El proceso real (volver a consultar Clientify, derivar y otorgar puntos) lo hace el cron cada 2 minutos.
// Un contacto nuevo espera ~2 minutos para no duplicar los referidos que el Hub está enviando (flujo B).

import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { igualesSeguro } from '../../lib/cron.js';
import { interpretarWebhook } from '../../lib/clientify/mapeo.js';

const DEMORA_CONTACTO_NUEVO_S = 120;

function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch { return { cuerpo_texto: req.body.slice(0, 20000) }; }
  }
  return {};
}

export default async function handler(req, res) {
  const secreto = process.env.CLIENTIFY_WEBHOOK_SECRET;
  if (!secreto) return res.status(500).json({ error: 'Falta configurar CLIENTIFY_WEBHOOK_SECRET' });

  const token = (req.query && req.query.token) || new URL(req.url || '/', 'http://x').searchParams.get('token');
  if (!igualesSeguro(Array.isArray(token) ? token[0] : token, secreto)) return res.status(401).json({ error: 'No autorizado' });

  // Algunas plataformas verifican la URL con GET antes de activar el webhook.
  if (req.method === 'GET' || req.method === 'HEAD') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const payload = leerCuerpo(req);
  const { entidad, entidadId, accion } = interpretarWebhook(payload);
  const nuevo = entidad === 'contacto' && /creat|nuev|add|new/i.test(String(accion || ''));
  try {
    const supabase = crearClienteServidor();
    const { error } = await supabase.rpc('webhook_clientify_recibir', {
      p_payload: payload, p_entidad: entidad, p_entidad_id: entidadId, p_accion: accion,
      p_demora_segundos: nuevo ? DEMORA_CONTACTO_NUEVO_S : 0
    });
    if (error) throw new Error([error.code, error.message].filter(Boolean).join(': '));
  } catch (e) {
    // 500 hace que Clientify reintente el envío.
    console.error('webhook clientify: no se pudo guardar el evento:', String(e.message || e).slice(0, 200));
    return res.status(500).json({ error: 'No se pudo registrar el evento' });
  }
  return res.status(200).json({ ok: true });
}
