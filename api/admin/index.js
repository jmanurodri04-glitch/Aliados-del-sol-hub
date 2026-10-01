// POST /api/admin — acciones del panel de administración (CLAUDE.md §3, §4.8, §5, §5.1, §10).
//
// Un solo endpoint con { accion, ... } (el plan Hobby de Vercel admite 12 funciones por despliegue).
// 1. Toma al admin del token (nunca del cuerpo) y exige rol = 'admin' y cuenta activa.
// 2. Llama a la función public.admin_* correspondiente, que vuelve a verificar al admin, aplica la regla
//    y deja la acción en acciones_admin. Los aliados se identifican por codigo_aliado (§2).
// 3. `archivo_evento` devuelve una URL firmada de 5 minutos para revisar el registro de asistentes.
// Fase 10: `anular_canje` (devuelve los puntos de un canje no entregado) y `guardar_recompensa` (catálogo).
// Fase 11: `invitar_operador` (quien escanea el QR de canje; devuelve un enlace para crear la contraseña, que el
// panel copia para enviarlo por WhatsApp o correo) y `estado_operador` (desactivar o reactivar).

import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { adminDeLaSesion, cuerpoJson, ErrorHttp, responderError } from '../../lib/sesion.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODIGO = /^[A-Za-z0-9]{6,20}$/;

// Errores de la base (prefijo estable) → código HTTP. El detalle de la base ya está en español.
const ERRORES = {
  no_autorizado: 403, no_permitido: 403, aliado_inexistente: 404, evento_inexistente: 404, conflicto_inexistente: 404,
  canje_inexistente: 404, recompensa_inexistente: 404, operador_inexistente: 404, estado_invalido: 409, dato_invalido: 422,
  evento_incompleto: 422
};

export function errorDeAdmin(mensaje) {
  const [codigo, ...resto] = String(mensaje || '').split(':');
  const status = ERRORES[codigo.trim()];
  if (!status) return null;
  const detalle = resto.join(':').trim();
  return new ErrorHttp(status, detalle ? detalle.charAt(0).toUpperCase() + detalle.slice(1) + '.' : 'No se pudo completar la acción.');
}

const codigo = (c) => {
  const v = String(c.codigo || '').trim();
  if (!CODIGO.test(v)) throw new ErrorHttp(400, 'Código de aliado inválido.');
  return v;
};
const uuid = (v, campo) => {
  const s = String(v || '').trim().toLowerCase();
  if (!UUID.test(s)) throw new ErrorHttp(400, `Falta ${campo}.`);
  return s;
};
const texto = (v) => String(v || '').slice(0, 1000);
// Campos de una recompensa que acepta el panel; el resto del cuerpo se ignora.
const CAMPOS_RECOMPENSA = ['codigo', 'nombre', 'descripcion', 'categoria', 'puntos', 'nivel_minimo', 'proveedor', 'activa'];
const recompensa = (c) => {
  const d = c.datos && typeof c.datos === 'object' ? c.datos : {};
  return Object.fromEntries(CAMPOS_RECOMPENSA.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
};
const entero = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ErrorHttp(422, 'Los puntos deben ser un número entero.');
  return n;
};

// accion → [función de la base, parámetros a partir del cuerpo y del admin]
const ACCIONES = {
  aprobar: ['admin_aprobar_aliado', (c, a) => ({ p_admin: a, p_codigo: codigo(c) })],
  rechazar: ['admin_rechazar_aliado', (c, a) => ({ p_admin: a, p_codigo: codigo(c), p_motivo: texto(c.motivo) })],
  suspender: ['admin_suspender_aliado', (c, a) => ({ p_admin: a, p_codigo: codigo(c), p_motivo: texto(c.motivo) })],
  reactivar: ['admin_reactivar_aliado', (c, a) => ({ p_admin: a, p_codigo: codigo(c), p_motivo: texto(c.motivo) })],
  ajuste: ['admin_ajuste_puntos', (c, a) => ({ p_admin: a, p_codigo: codigo(c), p_puntos: entero(c.puntos), p_nota: texto(c.nota), p_clave: uuid(c.clave, 'la clave del ajuste') })],
  baja_calidad: ['admin_baja_calidad', (c, a) => ({ p_admin: a, p_codigo: codigo(c), p_nota: texto(c.nota) })],
  validar_evento: ['admin_validar_evento', (c, a) => ({ p_admin: a, p_evento: uuid(c.evento_id, 'el evento'), p_nota: texto(c.nota) || null })],
  rechazar_evento: ['admin_rechazar_evento', (c, a) => ({ p_admin: a, p_evento: uuid(c.evento_id, 'el evento'), p_motivo: texto(c.motivo) })],
  resolver_conflicto: ['admin_resolver_conflicto', (c, a) => {
    const ajuste = c.ajuste === undefined || c.ajuste === null || c.ajuste === '' ? null : entero(c.ajuste);
    return {
      p_admin: a, p_conflicto: uuid(c.conflicto_id, 'el conflicto'), p_nota: texto(c.nota),
      p_aceptar_valor: c.aceptar_valor === true, p_ajuste: ajuste, p_clave: ajuste ? uuid(c.clave, 'la clave del ajuste') : null
    };
  }],
  anular_canje: ['admin_anular_canje', (c, a) => ({ p_admin: a, p_canje: uuid(c.canje_id, 'el canje'), p_motivo: texto(c.motivo) })],
  guardar_recompensa: ['admin_guardar_recompensa', (c, a) => ({
    p_admin: a, p_recompensa: c.recompensa_id ? uuid(c.recompensa_id, 'la recompensa') : null, p_datos: recompensa(c)
  })],
  estado_operador: ['admin_estado_operador', (c, a) => ({
    p_admin: a, p_operador: uuid(c.operador_id, 'el operador'), p_activo: c.activo === true, p_motivo: texto(c.motivo) || null
  })]
};

// Invita a un operador. La base lo registra (y lo audita); luego Supabase genera el enlace con el que crea su
// contraseña: 'invite' si el correo no tiene cuenta, 'recovery' si es una cuenta de operador que nunca la creó.
// Si el correo ya es de un aliado, entra con la contraseña que ya tiene y no hay enlace (así un admin no puede
// tomar la cuenta de un aliado). El enlace no se envía por correo: el panel lo muestra para copiarlo.
async function invitarOperador(supabase, cuerpo, adminId, req) {
  const datos = { correo: String(cuerpo.correo || '').trim(), nombre: String(cuerpo.nombre || '').trim(), proveedor: String(cuerpo.proveedor || '').trim() };
  const { data, error } = await supabase.rpc('admin_invitar_operador', { p_admin: adminId, p_datos: datos });
  if (error) throw errorDeAdmin(error.message) || new Error('admin_invitar_operador falló');
  if (data.cuenta === 'aliado') return { ...data, enlace: null };

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const opciones = host ? { redirectTo: `https://${host}/canje.html` } : {};
  const { data: link, error: errorLink } = await supabase.auth.admin.generateLink({
    type: data.cuenta === 'nueva' ? 'invite' : 'recovery', email: data.correo, options: opciones
  });
  const enlace = link && link.properties && link.properties.action_link;
  if (errorLink || !enlace) throw new ErrorHttp(502, 'El operador quedó registrado, pero no pudimos crear el enlace. Vuelve a invitarlo.');
  return { ...data, enlace };
}

// URL firmada de corta duración para el registro de asistentes de un evento.
async function archivoEvento(supabase, cuerpo) {
  const eventoId = uuid(cuerpo.evento_id, 'el evento');
  const { data: evento, error } = await supabase
    .from('eventos').select('registro_asistentes_path').eq('id', eventoId).maybeSingle();
  if (error) throw new Error('lectura del evento falló');
  if (!evento || !evento.registro_asistentes_path) throw new ErrorHttp(404, 'Este evento no tiene archivo de asistentes.');
  const { data, error: errorUrl } = await supabase.storage.from('eventos').createSignedUrl(evento.registro_asistentes_path, 300);
  if (errorUrl || !data) throw new ErrorHttp(500, 'No pudimos abrir el archivo. Intenta de nuevo.');
  return { url: data.signedUrl };
}

// `supabase` solo se inyecta en los tests; Vercel llama al handler con (req, res).
export default async function handler(req, res, supabase = null) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  try {
    supabase = supabase || crearClienteServidor();
    const admin = await adminDeLaSesion(req, supabase);
    const cuerpo = cuerpoJson(req);

    if (cuerpo.accion === 'archivo_evento') return res.status(200).json(await archivoEvento(supabase, cuerpo));
    if (cuerpo.accion === 'invitar_operador') return res.status(200).json(await invitarOperador(supabase, cuerpo, admin.id, req));

    const accion = ACCIONES[cuerpo.accion];
    if (!accion) throw new ErrorHttp(400, 'Acción desconocida.');
    const [funcion, parametros] = accion;
    const { data, error } = await supabase.rpc(funcion, parametros(cuerpo, admin.id));
    if (error) throw errorDeAdmin(error.message) || new Error(funcion + ' falló');
    return res.status(200).json(data);
  } catch (e) {
    return responderError(res, e);
  }
}
