// POST /api/canjes — canje de Puntos Sol por un proveedor externo (CLAUDE.md §4.10, §10).
//
// Autenticación: `Authorization: Bearer <api key>`. Las keys viven en CANJES_API_KEYS con el formato
// `proveedor1:key1,proveedor2:key2` (una por proveedor). El proveedor sale de la key, nunca del cuerpo.
//
//   { accion: 'consultar', codigo_aliado } → 200 { codigo_aliado, activo, nivel, puntos_disponibles, recompensas[] }
//     Sin datos personales: lo justo para que el proveedor sepa qué puede ofrecer.
//   { accion: 'canjear', codigo_aliado, recompensa, referencia_externa } → 201 { canje_id, puntos, puntos_disponibles, nivel, … }
//     Los puntos y el nivel mínimo salen del catálogo `recompensas`. Repetir la misma referencia es seguro:
//     responde 200 con el canje original y `duplicado: true`, sin descontar de nuevo.
//
// El aliado se identifica por codigo_aliado (nunca por aliados.id, §2).

import { createHash, timingSafeEqual } from 'node:crypto';
import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { cuerpoJson, ErrorHttp, responderError } from '../../lib/sesion.js';

const CODIGO = /^[A-Za-z0-9]{6,20}$/;
const RECOMPENSA = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const PROVEEDOR = /^[a-z0-9_-]{2,40}$/;

const ERRORES = {
  dato_invalido: 422, aliado_inexistente: 404, recompensa_inexistente: 404, aliado_no_activo: 409,
  nivel_insuficiente: 409, saldo_insuficiente: 409, referencia_duplicada: 409, limite_canjes: 429
};

/** Error de la base → respuesta con el código estable (el proveedor lo usa para decidir) y un mensaje legible. */
export function errorDeCanje(mensaje) {
  const [codigo, ...resto] = String(mensaje || '').split(':');
  const status = ERRORES[codigo.trim()];
  if (!status) return null;
  const detalle = resto.join(':').trim();
  const e = new ErrorHttp(status, detalle ? detalle.charAt(0).toUpperCase() + detalle.slice(1) + '.' : 'No se pudo completar el canje.');
  e.codigo = codigo.trim();
  return e;
}

/** `proveedor:key,proveedor:key` → [{ proveedor, key }]. Ignora entradas mal formadas o keys de menos de 24 caracteres. */
export function leerApiKeys(texto) {
  return String(texto || '').split(',').map((par) => {
    const i = par.indexOf(':');
    if (i < 0) return null;
    const proveedor = par.slice(0, i).trim().toLowerCase();
    const key = par.slice(i + 1).trim();
    return PROVEEDOR.test(proveedor) && key.length >= 24 ? { proveedor, key } : null;
  }).filter(Boolean);
}

const huella = (v) => createHash('sha256').update(String(v)).digest();

/** Proveedor dueño de la key del encabezado, o null. Compara contra todas las keys en tiempo constante. */
export function proveedorDeLaKey(authorization, keys) {
  const m = String(authorization || '').match(/^Bearer\s+(\S+)$/);
  if (!m) return null;
  const recibida = huella(m[1]);
  let proveedor = null;
  for (const k of keys) {
    if (timingSafeEqual(recibida, huella(k.key)) && proveedor === null) proveedor = k.proveedor;
  }
  return proveedor;
}

function codigoAliado(c) {
  const v = String(c.codigo_aliado || '').trim();
  if (!CODIGO.test(v)) throw new ErrorHttp(422, 'codigo_aliado inválido.');
  return v;
}

// `supabase` y `entorno` solo se inyectan en los tests; Vercel llama al handler con (req, res).
export default async function handler(req, res, supabase = null, entorno = process.env) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  try {
    const keys = leerApiKeys(entorno.CANJES_API_KEYS);
    if (!keys.length) throw new ErrorHttp(503, 'El servicio de canjes no está configurado.');
    const proveedor = proveedorDeLaKey(req.headers.authorization, keys);
    if (!proveedor) throw new ErrorHttp(401, 'API key inválida.');

    const cuerpo = cuerpoJson(req);
    supabase = supabase || crearClienteServidor();

    if (cuerpo.accion === 'consultar') {
      const { data, error } = await supabase.rpc('consultar_canjes', { p_proveedor: proveedor, p_codigo: codigoAliado(cuerpo) });
      if (error) throw errorDeCanje(error.message) || new Error('consultar_canjes falló');
      return res.status(200).json(data);
    }

    if (cuerpo.accion === 'canjear') {
      const recompensa = String(cuerpo.recompensa || '').trim().toLowerCase();
      const referencia = String(cuerpo.referencia_externa || '').trim();
      if (!RECOMPENSA.test(recompensa)) throw new ErrorHttp(422, 'recompensa inválida.');
      if (!referencia || referencia.length > 100) throw new ErrorHttp(422, 'referencia_externa es obligatoria (máximo 100 caracteres).');
      const { data, error } = await supabase.rpc('registrar_canje', {
        p_proveedor: proveedor, p_codigo: codigoAliado(cuerpo), p_recompensa: recompensa, p_referencia: referencia
      });
      if (error) throw errorDeCanje(error.message) || new Error('registrar_canje falló');
      return res.status(data && data.duplicado ? 200 : 201).json(data);
    }

    throw new ErrorHttp(400, 'Acción desconocida. Usa "consultar" o "canjear".');
  } catch (e) {
    if (e instanceof ErrorHttp && e.codigo) return res.status(e.status).json({ error: e.message, codigo: e.codigo });
    return responderError(res, e);
  }
}
