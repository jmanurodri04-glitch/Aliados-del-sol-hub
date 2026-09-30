// Utilidades de los endpoints /api/cron/* (CLAUDE.md §8, §10).
// Se protegen con `Authorization: Bearer <CRON_SECRET>`, el mismo encabezado que envía Vercel Cron.

import { timingSafeEqual } from 'node:crypto';
import { crearClienteServidor } from './supabase-servidor.js';
import { crearClienteClientify } from './clientify/cliente.js';
import { procesarAliados, procesarEmpresas, procesarEntidades } from './clientify/cola.js';

/** Comparación en tiempo constante. */
export function igualesSeguro(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Verifica método y secreto. Si algo falla, responde y devuelve false.
 */
export function validarCron(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Método no permitido' });
    return false;
  }
  if (!process.env.CRON_SECRET) {
    res.status(500).json({ error: 'Falta configurar CRON_SECRET' });
    return false;
  }
  if (!igualesSeguro(req.headers.authorization, 'Bearer ' + process.env.CRON_SECRET)) {
    res.status(401).json({ error: 'No autorizado' });
    return false;
  }
  return true;
}

export function contextoClientify({ presupuestoMs = 40000 } = {}) {
  const inicio = Date.now();
  return {
    supabase: crearClienteServidor(),
    clientify: crearClienteClientify({ apiKey: process.env.CLIENTIFY_API_KEY, urlBase: process.env.CLIENTIFY_API_URL || undefined }),
    entorno: process.env.VERCEL_ENV || 'development',
    seguir: () => Date.now() - inicio < presupuestoMs
  };
}

/** Las tres colas, en orden: aliados (flujo A), oportunidades del Hub (flujo B) y eventos de Clientify (flujo C). */
export async function procesarColas(contexto) {
  const aliados = await procesarAliados(contexto);
  const empresas = await procesarEmpresas(contexto);
  const entidades = await procesarEntidades(contexto);
  console.log(`clientify ${contexto.entorno}: aliados ok=${aliados.ok} err=${aliados.errores} · empresas ok=${empresas.ok} err=${empresas.errores}` +
    ` · eventos ok=${entidades.ok} err=${entidades.errores}`);
  return { entorno: contexto.entorno, aliados, empresas, entidades };
}
