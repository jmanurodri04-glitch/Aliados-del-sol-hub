// POST /api/cotizador — Cotizador Solar y Comparador de propuestas de Herramientas, solo con sesión de aliado
// (Authorization: Bearer <token>; CLAUDE.md §7.5 y §7.6).
//
//   { accion: 'simular', id?, segmento, datos, unidad, valor, aislado, bateria, autoriza }  → 201 { id }
//     «Conectar al inversor»: valida, recalcula el diseño en el servidor y lo guarda a nombre del aliado en la tabla de
//     su tipo. Con `id` de una cotización suya sin propuesta pedida, la actualiza. 409 si ya usa ese nombre.
//   { accion: 'nombre', nombre, id? }  → 200 { disponible, mensaje? }
//     Paso 2: avisa si el aliado ya usa ese nombre de empresa o de persona en otra cotización.
//   { accion: 'correo', correo }  → 200 { aliado }
//     Paso 2: avisa si el correo es de un aliado (no se acepta: escribe otro).
//   { accion: 'propuesta', segmento, id }  → 200 { ok: true, clientify: 'ok' | 'pendiente', puntos }
//     «Solicitar propuesta»: la pone en la cola de Clientify y la intenta enviar enseguida; si Clientify falla, la
//     reintenta el cron (/api/cron/clientify). Nunca hace fallar la solicitud. La primera vez da +5 Puntos Sol.
//   { accion: 'meddpicc', segmento, id, respuestas }  → 200 { ok: true }
//     Las 7 preguntas que se responden antes de descargar el PDF.
//   { accion: 'mis_cotizaciones' }  → 200 { cotizaciones }
//     Comparador de propuestas: las cotizaciones del aliado para llenar una columna.

import { crearClienteServidor } from '../lib/supabase-servidor.js';
import { crearClienteClientify } from '../lib/clientify/cliente.js';
import { procesarCotizaciones } from '../lib/clientify/cotizador.js';
import { cuerpoJson, ErrorHttp, responderError } from '../lib/sesion.js';
import { guardarMeddpicc, misCotizaciones, revisarCorreo, revisarNombre, simular, solicitarPropuesta } from '../lib/cotizador.js';

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

// `inyectado` solo lo usan las pruebas (cliente de Supabase y variables de entorno simulados).
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
      return res.status(201).json(await simular(req, cuerpo, { supabase, entorno }));
    }
    if (cuerpo.accion === 'nombre') {
      return res.status(200).json(await revisarNombre(req, cuerpo, { supabase, entorno }));
    }
    if (cuerpo.accion === 'correo') {
      return res.status(200).json(await revisarCorreo(req, cuerpo, { supabase, entorno }));
    }
    if (cuerpo.accion === 'propuesta') {
      const { segmento, id, estado, puntos } = await solicitarPropuesta(req, cuerpo, { supabase, entorno });
      const clientify = estado === 'ok' ? 'ok' : await enviarAhora(supabase, segmento, id, entorno);
      return res.status(200).json({ ok: true, clientify, puntos });
    }
    if (cuerpo.accion === 'meddpicc') {
      return res.status(200).json(await guardarMeddpicc(req, cuerpo, { supabase, entorno }));
    }
    if (cuerpo.accion === 'mis_cotizaciones') {
      return res.status(200).json(await misCotizaciones(req, { supabase }));
    }
    throw new ErrorHttp(400, 'Solicitud inválida.');
  } catch (e) {
    return responderError(res, e);
  }
}
