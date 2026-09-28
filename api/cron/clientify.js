// GET|POST /api/cron/clientify — procesa las colas de sincronización con Clientify (CLAUDE.md §8):
//   flujo A (aliados aprobados) y flujo B (oportunidades registradas en el Hub).
// Es idempotente: se puede llamar cuantas veces se quiera. Protegido con `Authorization: Bearer <CRON_SECRET>`
// (el mismo encabezado que envía Vercel Cron). Lo llaman pg_cron cada 15 min y Vercel Cron una vez al día.

import { timingSafeEqual } from 'node:crypto';
import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { crearClienteClientify } from '../../lib/clientify/cliente.js';
import { procesarAliados, procesarEmpresas } from '../../lib/clientify/cola.js';

const PRESUPUESTO_MS = 40000; // deja margen dentro de maxDuration (vercel.json)

function autorizado(req) {
  const recibido = Buffer.from(String(req.headers.authorization || ''));
  const esperado = Buffer.from('Bearer ' + process.env.CRON_SECRET);
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
  let contexto;
  try {
    contexto = {
      supabase: crearClienteServidor(),
      clientify: crearClienteClientify({ apiKey: process.env.CLIENTIFY_API_KEY, urlBase: process.env.CLIENTIFY_API_URL || undefined }),
      entorno,
      seguir: () => Date.now() - inicio < PRESUPUESTO_MS
    };
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const aliados = await procesarAliados(contexto);
    const empresas = await procesarEmpresas(contexto);
    console.log(`clientify ${entorno}: aliados ok=${aliados.ok} errores=${aliados.errores} · empresas ok=${empresas.ok} errores=${empresas.errores}`);
    return res.status(200).json({ entorno, aliados, empresas });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
