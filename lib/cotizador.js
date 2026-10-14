// Cotizador Solar: validación y guardado (POST /api/cotizador, CLAUDE.md §7.5).
//
// Cualquiera puede cotizar, con o sin sesión, y el cotizador está aparte del programa de puntos (no da puntos y sus
// tablas no se relacionan con las demás; decisión del equipo). Dos excepciones (14 oct 2026):
//   - el correo del paso 2 no puede ser el de un aliado (su contacto de Clientify dejaría de ser de aliado);
//   - «Solicitar propuesta» lleva el ID_aliado de quien refiere a Clientify: el aliado de la sesión o, sin sesión, el
//     del «Email de quien refiere» (opcional; si no es de un aliado, se ignora). El código solo se guarda mientras la
//     propuesta espera su envío.
// Protecciones, como el formulario público de referidos:
//   - captcha (Turnstile) al guardar la simulación;
//   - límite de intentos por hora por conexión (huella HMAC de la IP; la IP nunca se guarda);
//   - los resultados se recalculan aquí con js/cotizador-calculo.js: el navegador solo manda lo que escribió.

import { createHmac } from 'node:crypto';
import { ErrorHttp, aliadoDeLaSesion } from './sesion.js';
import { ipDelPedido, verificarCaptcha } from './referido-publico.js';
import {
  CORREO_RE, MENSAJE_CORREO_ALIADO, REG, SEGMENTOS, SUBSECTORES, bateriaDe, cityOf, errorDeConsumo, resultadosDe, tipoDeSegmento
} from '../js/cotizador-calculo.js';

export const LIMITE_POR_HORA = 30;
export const MENSAJE_LIMITE = 'Hiciste muchos intentos seguidos. Espera un momento e intenta de nuevo.';
export const MENSAJE_CAPTCHA = 'Confirma que no eres un robot y vuelve a intentarlo.';
export const MENSAJE_ALIADO = MENSAJE_CORREO_ALIADO;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TELEFONO = /^\+[1-9][0-9]{6,14}$/;

const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const invalido = (mensaje) => new ErrorHttp(422, mensaje);

/** Huella de la conexión para el límite de intentos (HMAC-SHA256 de la IP; la IP no se guarda). */
export function huellaCotizador(ip, clave) {
  if (!clave) throw new Error('Falta la clave para la huella de conexión');
  return createHmac('sha256', clave).update('cotizador:' + ip).digest('hex');
}

/** Teléfono en formato internacional, con la regla de Colombia (10 dígitos que empiezan por 3). */
export function telefonoValido(t) {
  return TELEFONO.test(t) && (!t.startsWith('+57') || /^\+573[0-9]{9}$/.test(t));
}

/**
 * Valida lo que envía el navegador y arma la fila que se guarda (datos + resultados recalculados).
 * Devuelve { segmento, fila } o lanza ErrorHttp 422 con un mensaje para la persona.
 */
export function validarSimulacion(cuerpo) {
  const segmento = String(cuerpo.segmento || '');
  if (!SEGMENTOS.some((s) => s.id === segmento)) throw invalido('Elige el tipo de proyecto.');
  const d = cuerpo.datos && typeof cuerpo.datos === 'object' ? cuerpo.datos : {};
  const empresa = segmento !== 'residencial';

  const fila = {};
  const nombreValido = (k, mensaje) => {
    const v = texto(d[k]);
    if (v.length < 2 || v.length > 200) throw invalido(mensaje);
    fila[k] = v;
  };
  if (empresa) {
    nombreValido('empresa', 'Escribe el nombre de la empresa.');
    nombreValido('contacto', 'Escribe el nombre del contacto.');
    if (!SUBSECTORES.includes(d.subsector)) throw invalido('Selecciona el subsector.');
    fila.subsector = d.subsector;
  } else {
    nombreValido('nombre', 'Escribe tu nombre.');
  }

  const telefono = String(d.telefono || '').replace(/\s/g, '');
  if (!telefonoValido(telefono)) throw invalido('Revisa el teléfono.');
  const correo = String(d.correo || '').trim().toLowerCase();
  if (correo.length > 200 || !CORREO_RE.test(correo)) throw invalido('Revisa el correo.');
  const ciudad = cityOf(String(d.ciudad || ''));
  if (!ciudad) throw invalido('Selecciona la ciudad.');

  const unidad = cuerpo.unidad === 'cop' ? 'cop' : cuerpo.unidad === 'kwh' ? 'kwh' : null;
  if (!unidad) throw invalido('Elige si escribes el consumo en kWh o en pesos.');
  const valor = typeof cuerpo.valor === 'string' && cuerpo.valor.length <= 30 ? cuerpo.valor : '';
  const aislado = cuerpo.aislado === true;
  const st = { tipo: tipoDeSegmento(segmento), unidad, valor, aislado, bateria: String(cuerpo.bateria || ''), ciudad: ciudad.id, subsector: fila.subsector };
  const errConsumo = errorDeConsumo(st);
  if (errConsumo) throw invalido(errConsumo);
  if (!bateriaDe(aislado, st.bateria)) throw invalido('Elige el almacenamiento.');
  if (cuerpo.autoriza !== true) throw invalido('Marca la autorización de tratamiento de datos para continuar.');

  const r = resultadosDe(st);
  if (!r) throw invalido('Revisa el consumo.');
  Object.assign(fila, {
    telefono, correo, ciudad: ciudad.name, departamento: ciudad.dep, region: REG[ciudad.r].n,
    unidad, conectado_red: !aislado, almacenamiento: st.bateria
  }, r);
  return { segmento, fila };
}

async function contarIntento(supabase, req, entorno) {
  const ip = ipDelPedido(req);
  const { data, error } = await supabase.rpc('cotizador_intento', { p_huella: huellaCotizador(ip, entorno.SUPABASE_SECRET_KEY), p_limite: LIMITE_POR_HORA });
  if (error) throw new ErrorHttp(500, 'No pudimos procesar la solicitud. Intenta de nuevo.');
  if (data !== true) throw new ErrorHttp(429, MENSAJE_LIMITE);
  return ip;
}

async function esCorreoDeAliado(supabase, correo) {
  const { data, error } = await supabase.rpc('cotizador_correo_es_aliado', { p_correo: correo });
  if (error) throw new ErrorHttp(500, 'No pudimos verificar el correo. Intenta de nuevo.');
  return data === true;
}

/** Paso 2: ¿el correo es de un aliado? Cuenta como intento (límite por conexión). */
export async function revisarCorreo(req, cuerpo, { supabase, entorno }) {
  await contarIntento(supabase, req, entorno);
  const correo = String(cuerpo.correo || '').trim().toLowerCase();
  if (correo.length > 200 || !CORREO_RE.test(correo)) throw invalido('Revisa el correo.');
  return { aliado: await esCorreoDeAliado(supabase, correo) };
}

/**
 * Código del aliado que refiere: el de la sesión (si hay una válida de un aliado) o el del correo opcional. Un correo
 * que no es de un aliado se ignora (null), igual que una sesión vencida.
 */
export async function codigoReferente(req, cuerpo, supabase) {
  if (/^Bearer\s+\S/.test(String(req.headers.authorization || ''))) {
    try {
      const aliado = await aliadoDeLaSesion(req, supabase);
      return aliado.rol === 'aliado' ? aliado.codigo_aliado : null;
    } catch {
      return null;
    }
  }
  const correo = String(cuerpo.correo_referente || '').trim().toLowerCase();
  if (!correo || correo.length > 200 || !CORREO_RE.test(correo)) return null;
  const { data, error } = await supabase.rpc('cotizador_codigo_referente', { p_correo: correo });
  if (error) throw new Error('cotizador_codigo_referente falló');
  return data || null;
}

/** «Conectar al inversor»: guarda la simulación y devuelve su id. */
export async function simular(req, cuerpo, { supabase, entorno, fetchImpl }) {
  const ip = await contarIntento(supabase, req, entorno);
  if (!await verificarCaptcha(cuerpo.captcha, { ip, secreto: entorno.TURNSTILE_SECRET_KEY, entorno: entorno.VERCEL_ENV, fetchImpl })) {
    throw new ErrorHttp(403, MENSAJE_CAPTCHA);
  }
  const { segmento, fila } = validarSimulacion(cuerpo);
  if (await esCorreoDeAliado(supabase, fila.correo)) throw invalido(MENSAJE_ALIADO);
  const { data, error } = await supabase.rpc('cotizador_registrar_simulacion', { p_segmento: segmento, p_fila: fila });
  if (error || !data) {
    if (error && /check constraint|dato_invalido/.test(error.message || '')) throw invalido('Revisa los datos e intenta de nuevo.');
    throw new Error('cotizador_registrar_simulacion falló');
  }
  return { id: data };
}

/** «Solicitar propuesta»: la pone en la cola de Clientify. Devuelve { estado } ('pendiente' u 'ok'). */
export async function solicitarPropuesta(req, cuerpo, { supabase, entorno }) {
  await contarIntento(supabase, req, entorno);
  const segmento = String(cuerpo.segmento || '');
  const id = String(cuerpo.id || '');
  if (!SEGMENTOS.some((s) => s.id === segmento) || !UUID.test(id)) throw new ErrorHttp(400, 'Solicitud inválida.');
  const referente = await codigoReferente(req, cuerpo, supabase);
  const { data, error } = await supabase.rpc('cotizador_solicitar_propuesta', { p_segmento: segmento, p_id: id, p_referente: referente });
  if (error) {
    if (/simulacion_inexistente/.test(error.message || '')) throw new ErrorHttp(404, 'Este diseño ya venció. Conecta el inversor de nuevo para pedir la propuesta.');
    throw new Error('cotizador_solicitar_propuesta falló');
  }
  return { segmento, id, estado: (data && data.estado) || 'pendiente' };
}
