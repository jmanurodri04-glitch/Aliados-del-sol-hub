// Referido desde el formulario público del Hub (sin sesión; corrección de oct 2026, CLAUDE.md §7.1).
//
// Quien refiere escribe su correo de aliado. La base busca al aliado (public.registrar_oportunidad_publica) y
// registra la empresa con las mismas reglas de "Nueva oportunidad"; después pasa a Clientify por el flujo B.
//
// Protecciones, porque no hay sesión:
//   - Captcha (Cloudflare Turnstile, "Verifica que eres humano"): se verifica en el servidor con TURNSTILE_SECRET_KEY.
//     Con factura se verifica al pedir la subida y la base emite un permiso de un solo uso para registrar.
//   - Límite por conexión: la base cuenta los intentos por huella (HMAC de la IP con la clave secreta; nunca la IP).
//   - Mensaje ambiguo: un correo que no es de un aliado, un autorreferido o una cuenta que no puede referir
//     responden lo mismo, para no revelar quién es aliado ni sus datos.
//   - La respuesta no trae saldo, nivel ni código del aliado: solo los puntos de este referido.
//   - La factura va a publico/{empresa_id}/…: la ruta nunca lleva el id interno del aliado.

import { createHmac, randomUUID } from 'node:crypto';
import { ErrorHttp } from './sesion.js';

export const MENSAJE_AMBIGUO = 'Hubo un problema al registrar esta oportunidad. Verifica los datos e intenta de nuevo.';
export const MENSAJE_LIMITE = 'Recibimos muchos envíos desde tu conexión. Intenta de nuevo más tarde.';
export const MENSAJE_CAPTCHA = 'Confirma que no eres un robot y vuelve a enviar.';
const URL_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const LIMITE_POR_HORA = 20; // intentos por conexión (pedir la subida de la factura cuenta como uno)
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** IP del cliente según Vercel (primer valor de x-forwarded-for). */
export function ipDelPedido(req) {
  const h = req.headers || {};
  return String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim() || 'desconocida';
}

/** Huella de la conexión: HMAC-SHA256 de la IP con una clave del servidor. La IP no se guarda. */
export function huellaDeConexion(ip, clave) {
  if (!clave) throw new Error('Falta la clave para la huella de conexión');
  return createHmac('sha256', clave).update('referido-publico:' + ip).digest('hex');
}

/**
 * Verifica el captcha con Cloudflare. Sin TURNSTILE_SECRET_KEY: en Production el formulario no funciona (503) y en
 * Preview/Development se omite, para poder probar.
 */
export async function verificarCaptcha(token, { ip, secreto, entorno, fetchImpl = fetch }) {
  if (!secreto) {
    if (entorno === 'production') throw new ErrorHttp(503, 'El formulario no está disponible en este momento. Intenta más tarde.');
    return true;
  }
  if (!token || typeof token !== 'string' || token.length > 2048) return false;
  try {
    const cuerpo = new URLSearchParams({ secret: secreto, response: token });
    if (ip && ip !== 'desconocida') cuerpo.set('remoteip', ip);
    const r = await fetchImpl(URL_TURNSTILE, { method: 'POST', body: cuerpo });
    const datos = await r.json();
    return !!(datos && datos.success);
  } catch {
    throw new ErrorHttp(503, 'No pudimos verificar el captcha. Intenta de nuevo.');
  }
}

/** Cuenta el intento de esta conexión; responde 429 si superó el límite de la hora. */
async function contarIntento(supabase, huella) {
  const { data, error } = await supabase.rpc('referido_publico_intento', { p_huella: huella, p_limite: LIMITE_POR_HORA });
  if (error) throw new ErrorHttp(500, 'No pudimos procesar el envío. Intenta de nuevo.');
  if (data !== true) throw new ErrorHttp(429, MENSAJE_LIMITE);
}

function contexto(req, entorno) {
  const ip = ipDelPedido(req);
  return { ip, huella: huellaDeConexion(ip, entorno.SUPABASE_SECRET_KEY) };
}

/**
 * POST /api/oportunidades/factura con { publico: true, captcha, nombre_archivo, tipo, tamano }.
 * No pide el correo del aliado (este paso no revela quién es aliado). Verifica el captcha y deja un permiso de un
 * solo uso para registrar esta empresa con su factura.
 */
export async function prepararFacturaPublica(req, cuerpo, { supabase, entorno, fetchImpl, nombreArchivo }) {
  const { ip, huella } = contexto(req, entorno);
  await contarIntento(supabase, huella);
  if (!await verificarCaptcha(cuerpo.captcha, { ip, secreto: entorno.TURNSTILE_SECRET_KEY, entorno: entorno.VERCEL_ENV, fetchImpl })) {
    throw new ErrorHttp(403, MENSAJE_CAPTCHA);
  }
  const empresaId = randomUUID();
  const ruta = `publico/${empresaId}/${nombreArchivo}`;
  const { data, error } = await supabase.storage.from('facturas').createSignedUploadUrl(ruta);
  if (error || !data) throw new ErrorHttp(500, 'No pudimos preparar la subida de la factura. Intenta de nuevo.');
  const permiso = await supabase.rpc('referido_publico_permiso', { p_empresa_id: empresaId, p_huella: huella });
  if (permiso.error) throw new ErrorHttp(500, 'No pudimos preparar la subida de la factura. Intenta de nuevo.');
  return { empresa_id: empresaId, ruta: data.path, token: data.token };
}

// Errores de la base → respuesta pública. Lo que podría revelar si un correo es de un aliado, o sus datos, es ambiguo.
const ERRORES_PUBLICOS = {
  referidor_invalido: [422, MENSAJE_AMBIGUO],
  aliado_no_activo: [422, MENSAJE_AMBIGUO],
  autorreferido: [422, MENSAJE_AMBIGUO],
  limite_referidos: [429, MENSAJE_LIMITE],
  referido_duplicado: [409, 'Este contacto ya fue referido al programa.'],
  oportunidad_invalida: [422, null],
  factura_invalida: [422, null]
};

export function errorPublico(mensaje) {
  const [codigo, ...resto] = String(mensaje || '').split(':');
  const regla = ERRORES_PUBLICOS[codigo.trim()];
  if (!regla) return null;
  const detalle = resto.join(':').trim();
  return new ErrorHttp(regla[0], regla[1] || (detalle ? detalle.charAt(0).toUpperCase() + detalle.slice(1) + '.' : 'Revisa los datos.'));
}

/**
 * POST /api/oportunidades con { publico: true, correo_aliado, captcha?, empresa_id, datos, factura? }.
 * Sin factura verifica el captcha aquí; con factura, la base exige el permiso de esa empresa.
 * Devuelve { empresaId, resultado: { es_perfecto, puntos } } o lanza ErrorHttp.
 */
export async function registrarPublico(req, cuerpo, { supabase, entorno, fetchImpl, empresaId, datos, factura }) {
  const { ip, huella } = contexto(req, entorno);
  await contarIntento(supabase, huella);
  if (!factura && !await verificarCaptcha(cuerpo.captcha, { ip, secreto: entorno.TURNSTILE_SECRET_KEY, entorno: entorno.VERCEL_ENV, fetchImpl })) {
    throw new ErrorHttp(403, MENSAJE_CAPTCHA);
  }
  const correoAliado = String(cuerpo.correo_aliado || '').trim().toLowerCase();
  if (!CORREO.test(correoAliado) || correoAliado.length > 254) throw new ErrorHttp(422, 'Escribe un correo válido de quien refiere.');
  if (factura && (!factura.storage_path.startsWith(`publico/${empresaId}/`) || factura.storage_path.includes('..'))) {
    throw new ErrorHttp(422, 'La factura no corresponde a esta oportunidad.');
  }
  const { data, error } = await supabase.rpc('registrar_oportunidad_publica', {
    p_correo_aliado: correoAliado, p_empresa_id: empresaId, p_datos: datos, p_factura: factura
  });
  if (error) throw errorPublico(error.message) || new Error('registrar_oportunidad_publica falló');
  return { es_perfecto: !!data.es_perfecto, puntos: Number(data.puntos) || 0 };
}
