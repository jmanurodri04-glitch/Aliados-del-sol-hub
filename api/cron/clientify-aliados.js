// GET|POST /api/cron/clientify-aliados — sincroniza con Clientify los aliados aprobados (CLAUDE.md §8, flujo A).
//
// Procesa un lote de la cola (aliados `activo` en estado de sincronización 'pendiente' o 'error' cuya espera
// ya se cumplió) y registra el resultado de cada uno. Es idempotente: se puede llamar cuantas veces se quiera.
// Protegido con `Authorization: Bearer <CRON_SECRET>` (el mismo encabezado que envía Vercel Cron).

import { timingSafeEqual } from 'node:crypto';
import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { crearClienteClientify } from '../../lib/clientify/cliente.js';
import { sincronizarAliado } from '../../lib/clientify/aliados.js';

const TAMANO_LOTE = 5;
const PRESUPUESTO_MS = 40000; // deja margen dentro de maxDuration (vercel.json)

function autorizado(req) {
  const secreto = process.env.CRON_SECRET;
  const recibido = Buffer.from(String(req.headers.authorization || ''));
  const esperado = Buffer.from('Bearer ' + secreto);
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  if (!process.env.CRON_SECRET) return res.status(500).json({ error: 'Falta configurar CRON_SECRET' });
  if (!autorizado(req)) return res.status(401).json({ error: 'No autorizado' });

  const inicio = Date.now();
  const entorno = process.env.VERCEL_ENV || 'development';
  let supabase;
  let clientify;
  try {
    supabase = crearClienteServidor();
    clientify = crearClienteClientify({ apiKey: process.env.CLIENTIFY_API_KEY, urlBase: process.env.CLIENTIFY_API_URL || undefined });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const { data: lote, error } = await supabase.rpc('clientify_reclamar_aliados', { p_limite: TAMANO_LOTE });
  if (error) return res.status(500).json({ error: 'No se pudo leer la cola de sincronización' });

  const resumen = { entorno, procesados: 0, ok: 0, errores: 0, pospuestos: 0, detalle: [] };
  for (const aliado of lote || []) {
    // Lo que no alcance a procesarse queda con su préstamo de 10 minutos y se toma en la siguiente ejecución.
    if (Date.now() - inicio > PRESUPUESTO_MS) { resumen.pospuestos++; continue; }
    resumen.procesados++;
    try {
      const { contactId, accion } = await sincronizarAliado(aliado, { clientify, entorno });
      const { error: errorRegistro } = await supabase.rpc('clientify_registrar_resultado', {
        p_aliado: aliado.aliado_id, p_contact_id: contactId, p_error: null
      });
      if (errorRegistro) throw new Error('Sincronizado en Clientify pero no se pudo registrar el resultado');
      resumen.ok++;
      resumen.detalle.push({ codigo_aliado: aliado.codigo_aliado, accion });
    } catch (e) {
      const motivo = e.message || 'Error desconocido';
      await supabase.rpc('clientify_registrar_resultado', { p_aliado: aliado.aliado_id, p_contact_id: null, p_error: motivo });
      resumen.errores++;
      resumen.detalle.push({ codigo_aliado: aliado.codigo_aliado, error: motivo });
    }
  }

  // En los logs solo van conteos: nunca correos, nombres ni tokens (§10).
  console.log(`clientify-aliados ${entorno}: procesados=${resumen.procesados} ok=${resumen.ok} errores=${resumen.errores} pospuestos=${resumen.pospuestos}`);
  return res.status(200).json(resumen);
}
