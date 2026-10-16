// Cotizador Solar: validación y guardado (POST /api/cotizador, CLAUDE.md §7.5).
//
// Solo para aliados con sesión (16 oct 2026): cada cotización queda a nombre del aliado de la sesión (aliado_id, que
// nunca sale de la base) y el nombre de la empresa (comercial/industrial) o de la persona (residencial) no se repite
// entre sus cotizaciones. «Solicitar propuesta» da +5 Puntos Sol la primera vez (uso_cotizador). A Clientify no va el
// ID_aliado (decisión del equipo: la referencia del Hub manda); el código del aliado va solo en la descripción.
// Protecciones:
//   - la sesión (aliadoDeLaSesion: cuenta activa) en todas las acciones;
//   - límite de intentos por hora por aliado (huella HMAC; tabla cotizador_intentos);
//   - el correo del paso 2 no puede ser el de un aliado (su contacto de Clientify dejaría de ser de aliado);
//   - los resultados se recalculan aquí con js/cotizador-calculo.js: el navegador solo manda lo que escribió;
//   - las respuestas MEDDPICC se validan con js/cotizador-meddpicc.js.

import { createHmac } from 'node:crypto';
import { ErrorHttp, aliadoDeLaSesion } from './sesion.js';
import {
  CORREO_RE, MENSAJE_CORREO_ALIADO, REG, SEGMENTOS, SUBSECTORES, bateriaDe, cityOf, errorDeConsumo, resultadosDe, tipoDeSegmento
} from '../js/cotizador-calculo.js';
import { validarMeddpicc } from '../js/cotizador-meddpicc.js';

export const LIMITE_POR_HORA = 60;
export const MENSAJE_LIMITE = 'Hiciste muchos intentos seguidos. Espera un momento e intenta de nuevo.';
export const MENSAJE_ALIADO = MENSAJE_CORREO_ALIADO;
export const MENSAJE_SOLO_ALIADOS = 'El Cotizador Solar es solo para aliados.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TELEFONO = /^\+[1-9][0-9]{6,14}$/;

const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const invalido = (mensaje) => new ErrorHttp(422, mensaje);
const idOpcional = (v) => (UUID.test(String(v || '')) ? String(v) : null);

/** Mensaje cuando el aliado ya usa ese nombre en otra de sus cotizaciones. */
export function mensajeNombreRepetido(nombre) {
  const n = texto(nombre) || 'ese nombre';
  return 'Ya tienes una cotización con el nombre «' + n + '». Para guardar otra, agrégale un número (por ejemplo, «'
    + n + ' 2»). Tus cotizaciones anteriores se conservan.';
}

/** Huella del aliado para el límite de intentos (HMAC-SHA256; el id no se guarda en esa tabla). */
export function huellaCotizador(aliadoId, clave) {
  if (!clave) throw new Error('Falta la clave para la huella del límite de intentos');
  return createHmac('sha256', clave).update('cotizador:aliado:' + aliadoId).digest('hex');
}

/** Teléfono en formato internacional, con la regla de Colombia (10 dígitos que empiezan por 3). */
export function telefonoValido(t) {
  return TELEFONO.test(t) && (!t.startsWith('+57') || /^\+573[0-9]{9}$/.test(t));
}

/** Nombre que no se repite: el de la empresa (comercial/industrial) o el de la persona (residencial). */
export const nombreDe = (segmento, fila) => (segmento === 'residencial' ? fila.nombre : fila.empresa);

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
    nombreValido('nombre', 'Escribe el nombre del cliente.');
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

/** Segmento e id de una cotización del pedido, o 400. */
function cotizacionDelPedido(cuerpo) {
  const segmento = String(cuerpo.segmento || '');
  const id = String(cuerpo.id || '');
  if (!SEGMENTOS.some((s) => s.id === segmento) || !UUID.test(id)) throw new ErrorHttp(400, 'Solicitud inválida.');
  return { segmento, id };
}

/** Aliado de la sesión (solo rol aliado) y un intento más en su límite por hora. */
async function aliadoConIntento(req, supabase, entorno) {
  const aliado = await aliadoDeLaSesion(req, supabase);
  if (aliado.rol !== 'aliado') throw new ErrorHttp(403, MENSAJE_SOLO_ALIADOS);
  const { data, error } = await supabase.rpc('cotizador_intento', { p_huella: huellaCotizador(aliado.id, entorno.SUPABASE_SECRET_KEY), p_limite: LIMITE_POR_HORA });
  if (error) throw new ErrorHttp(500, 'No pudimos procesar la solicitud. Intenta de nuevo.');
  if (data !== true) throw new ErrorHttp(429, MENSAJE_LIMITE);
  return aliado;
}

/** Errores conocidos de las funciones de la base; los demás se vuelven un 500 genérico. */
function errorDeLaBase(error, nombre, contexto = {}) {
  const m = (error && error.message) || '';
  if (/aliado_no_activo/.test(m)) return new ErrorHttp(403, MENSAJE_SOLO_ALIADOS);
  if (/nombre_repetido/.test(m)) return new ErrorHttp(409, mensajeNombreRepetido(contexto.nombre));
  if (/simulacion_inexistente/.test(m)) return new ErrorHttp(404, contexto.inexistente || 'No encontramos esta cotización. Conecta el inversor de nuevo.');
  if (/check constraint|dato_invalido/.test(m)) return invalido('Revisa los datos e intenta de nuevo.');
  return new Error(nombre + ' falló');
}

async function esCorreoDeAliado(supabase, correo) {
  const { data, error } = await supabase.rpc('cotizador_correo_es_aliado', { p_correo: correo });
  if (error) throw new ErrorHttp(500, 'No pudimos verificar el correo. Intenta de nuevo.');
  return data === true;
}

/** Paso 2: ¿el correo es de un aliado? */
export async function revisarCorreo(req, cuerpo, { supabase, entorno }) {
  await aliadoConIntento(req, supabase, entorno);
  const correo = String(cuerpo.correo || '').trim().toLowerCase();
  if (correo.length > 200 || !CORREO_RE.test(correo)) throw invalido('Revisa el correo.');
  return { aliado: await esCorreoDeAliado(supabase, correo) };
}

/** Paso 2: ¿el aliado ya usa este nombre? `id`: la cotización que está editando (su propio nombre sí sirve). */
export async function revisarNombre(req, cuerpo, { supabase, entorno }) {
  const aliado = await aliadoConIntento(req, supabase, entorno);
  const nombre = texto(cuerpo.nombre);
  if (nombre.length < 2 || nombre.length > 200) throw invalido('Escribe el nombre.');
  const { data, error } = await supabase.rpc('cotizador_nombre_disponible', { p_aliado: aliado.id, p_nombre: nombre, p_excluir: idOpcional(cuerpo.id) });
  if (error) throw errorDeLaBase(error, 'cotizador_nombre_disponible');
  return data === true ? { disponible: true } : { disponible: false, mensaje: mensajeNombreRepetido(nombre) };
}

/**
 * «Conectar al inversor»: guarda la cotización y devuelve su id. Con `id` de una cotización suya que aún no pidió
 * propuesta, la actualiza (el aliado volvió a editar); si no, crea otra.
 */
export async function simular(req, cuerpo, { supabase, entorno }) {
  const aliado = await aliadoConIntento(req, supabase, entorno);
  const { segmento, fila } = validarSimulacion(cuerpo);
  if (await esCorreoDeAliado(supabase, fila.correo)) throw invalido(MENSAJE_ALIADO);
  const { data, error } = await supabase.rpc('cotizador_guardar_simulacion', { p_aliado: aliado.id, p_segmento: segmento, p_fila: fila, p_id: idOpcional(cuerpo.id) });
  if (error || !data) throw errorDeLaBase(error, 'cotizador_guardar_simulacion', { nombre: nombreDe(segmento, fila) });
  return { id: data };
}

/** «Solicitar propuesta»: la pone en la cola de Clientify. Devuelve { segmento, id, estado, puntos }. */
export async function solicitarPropuesta(req, cuerpo, { supabase, entorno }) {
  const aliado = await aliadoConIntento(req, supabase, entorno);
  const { segmento, id } = cotizacionDelPedido(cuerpo);
  const { data, error } = await supabase.rpc('cotizador_solicitar_propuesta', { p_aliado: aliado.id, p_segmento: segmento, p_id: id });
  if (error) throw errorDeLaBase(error, 'cotizador_solicitar_propuesta', { inexistente: 'Este diseño ya venció. Conecta el inversor de nuevo para pedir la propuesta.' });
  return { segmento, id, estado: (data && data.estado) || 'pendiente', puntos: Number(data && data.puntos) || 0 };
}

/** Preguntas antes del PDF: valida y guarda las respuestas con la cotización. */
export async function guardarMeddpicc(req, cuerpo, { supabase, entorno }) {
  const aliado = await aliadoConIntento(req, supabase, entorno);
  const { segmento, id } = cotizacionDelPedido(cuerpo);
  const v = validarMeddpicc(cuerpo.respuestas, segmento);
  if (!v.ok) throw invalido(v.error);
  const { error } = await supabase.rpc('cotizador_guardar_meddpicc', { p_aliado: aliado.id, p_segmento: segmento, p_id: id, p_respuestas: v.valor });
  if (error) throw errorDeLaBase(error, 'cotizador_guardar_meddpicc');
  return { ok: true };
}

/** Comparador de propuestas: las cotizaciones del aliado (sin teléfono ni correo). No cuenta como intento. */
export async function misCotizaciones(req, { supabase }) {
  const aliado = await aliadoDeLaSesion(req, supabase);
  if (aliado.rol !== 'aliado') throw new ErrorHttp(403, MENSAJE_SOLO_ALIADOS);
  const { data, error } = await supabase.rpc('cotizador_mis_cotizaciones', { p_aliado: aliado.id });
  if (error) throw errorDeLaBase(error, 'cotizador_mis_cotizaciones');
  return { cotizaciones: Array.isArray(data) ? data : [] };
}
