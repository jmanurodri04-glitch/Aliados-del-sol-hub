// POST /api/cotizador — Cotizador Solar de Herramientas, con o sin sesión (CLAUDE.md §7.5).
//
//   { accion: 'simular', captcha, segmento, datos, unidad, valor, aislado, bateria, autoriza }  → 201 { id }
//     «Conectar al inversor»: valida, recalcula el diseño en el servidor y lo guarda en la tabla de su tipo
//     (cotizador_residencial | cotizador_comercial | cotizador_industrial).
//   { accion: 'correo', correo }  → 200 { aliado }
//     Paso 2: avisa si el correo es de un aliado (no se acepta: escribe otro).
//   { accion: 'propuesta', segmento, id, correo_referente? }  → 200 { ok: true, clientify: 'ok' | 'pendiente' }
//     «Solicitar propuesta»: la pone en la cola de Clientify y la intenta enviar enseguida; si Clientify falla,
//     la reintenta el cron (/api/cron/clientify). Nunca hace fallar la solicitud. Lleva a Clientify el ID_aliado de
//     quien refiere: el de la sesión (encabezado Authorization, opcional) o el de `correo_referente`.
// El cotizador no da puntos (decisión del equipo).

import { crearClienteServidor } from '../lib/supabase-servidor.js';
import { crearClienteClientify } from '../lib/clientify/cliente.js';
import { procesarCotizaciones } from '../lib/clientify/cotizador.js';
import { cuerpoJson, ErrorHttp, responderError } from '../lib/sesion.js';
import { revisarCorreo, simular, solicitarPropuesta } from '../lib/cotizador.js';

// Envío inmediato a Clientify (mejor esfuerzo).
async function enviarAhora(supabase, segmento, id, entorno) {
  if (!entorno.CLIENTIFY_API_KEY) return 'pendiente';
  try {
    const r = await procesarCotizaciones({
      supabase,
      clientify: crearClienteClientify({ apiKey: entorno.CLIENTIFY_API_KEY, urlBase: entorno.CLIENTIFY_API_URL || undefined }),
      entorno: entorno.VERCEL_ENV || 'development',
      segmento, id, limite: 1
    });
    return r.ok === 1 ? 'ok' : 'pendiente';
  } catch {
    return 'pendiente';
  }
}

// `inyectado` solo lo usan las pruebas (cliente de Supabase, variables de entorno y fetch simulados).
export default async function handler(req, res, inyectado = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  try {
    const supabase = inyectado.supabase || crearClienteServidor();
    const entorno = inyectado.entorno || process.env;
    const cuerpo = cuerpoJson(req);

    if (cuerpo.accion === 'simular') {
      return res.status(201).json(await simular(req, cuerpo, { supabase, entorno, fetchImpl: inyectado.fetch }));
    }
    if (cuerpo.accion === 'correo') {
      return res.status(200).json(await revisarCorreo(req, cuerpo, { supabase, entorno }));
    }
    if (cuerpo.accion === 'propuesta') {
      const { segmento, id, estado } = await solicitarPropuesta(req, cuerpo, { supabase, entorno });
      const clientify = estado === 'ok' ? 'ok' : await enviarAhora(supabase, segmento, id, entorno);
      return res.status(200).json({ ok: true, clientify });
    }
    throw new ErrorHttp(400, 'Solicitud inválida.');
  } catch (e) {
    return responderError(res, e);
  }
}
