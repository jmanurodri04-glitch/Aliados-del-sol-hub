// POST /api/eventos — el aliado reporta un evento desde el Hub (CLAUDE.md §4.8).
//
//   { accion: 'subir', nombre_archivo, tipo, tamano } → { evento_id, ruta, token }
//     Permiso de un solo uso para subir el registro de asistentes al bucket privado `eventos`, en
//     {aliado_id}/{evento_id}/{archivo}. El navegador sube directo a Storage (Vercel limita el cuerpo a 4,5 MB).
//   { accion: 'registrar', evento_id, datos, archivo? } → { evento_id, estado: 'pendiente' }
//     public.registrar_evento valida y guarda el evento. Un admin lo valida después (+100).
//
// El aliado sale siempre del token (nunca del cuerpo) y la cuenta debe estar activa.

import { randomUUID } from 'node:crypto';
import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { aliadoDeLaSesion, cuerpoJson, ErrorHttp, responderError } from '../../lib/sesion.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIPOS = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
};
const TAMANO_MAXIMO = 10 * 1024 * 1024;
const CAMPOS = ['nombre_evento', 'tipo_evento', 'fecha', 'geenera_involucrada', 'registro_asistentes', 'empresas_perfil_count', 'descripcion'];

const ERRORES = {
  aliado_no_activo: [403, 'Tu cuenta no está activa.'],
  limite_eventos: [429, 'Alcanzaste el máximo de 5 eventos reportados por día.'],
  evento_duplicado: [409, 'Este evento ya fue reportado.'],
  evento_invalido: [422, null],
  archivo_invalido: [422, null]
};

export function errorDeEvento(mensaje) {
  const [codigo, ...resto] = String(mensaje || '').split(':');
  const regla = ERRORES[codigo.trim()];
  if (!regla) return null;
  const detalle = resto.join(':').trim();
  return new ErrorHttp(regla[0], regla[1] || (detalle ? detalle.charAt(0).toUpperCase() + detalle.slice(1) + '.' : 'Revisa los datos.'));
}

/** Nombre de archivo seguro para Storage, con la extensión del tipo real. */
export function nombreSeguro(nombre, tipo) {
  const base = String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'asistentes'}.${TIPOS[tipo]}`;
}

// `supabase` solo se inyecta en los tests; Vercel llama al handler con (req, res).
export default async function handler(req, res, supabase = null) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  try {
    supabase = supabase || crearClienteServidor();
    const aliado = await aliadoDeLaSesion(req, supabase);
    const cuerpo = cuerpoJson(req);

    if (cuerpo.accion === 'subir') {
      const { nombre_archivo: nombre, tipo, tamano } = cuerpo;
      if (!TIPOS[tipo]) throw new ErrorHttp(422, 'El registro de asistentes debe ser PDF, imagen, Excel o CSV.');
      if (!(Number(tamano) > 0) || Number(tamano) > TAMANO_MAXIMO) throw new ErrorHttp(422, 'El archivo debe pesar máximo 10 MB.');
      const eventoId = randomUUID();
      const ruta = `${aliado.id}/${eventoId}/${nombreSeguro(nombre, tipo)}`;
      const { data, error } = await supabase.storage.from('eventos').createSignedUploadUrl(ruta);
      if (error || !data) throw new ErrorHttp(500, 'No pudimos preparar la subida del archivo. Intenta de nuevo.');
      return res.status(200).json({ evento_id: eventoId, ruta: data.path, token: data.token });
    }

    if (cuerpo.accion === 'registrar') {
      const eventoId = String(cuerpo.evento_id || '');
      if (!UUID.test(eventoId)) throw new ErrorHttp(400, 'Solicitud inválida.');
      const datos = Object.fromEntries(CAMPOS.filter((k) => cuerpo.datos && cuerpo.datos[k] !== undefined).map((k) => [k, cuerpo.datos[k]]));
      const archivo = cuerpo.archivo ? String(cuerpo.archivo) : null;
      // Solo la carpeta del aliado de la sesión y de este evento; la base lo vuelve a verificar.
      if (archivo && (!archivo.startsWith(`${aliado.id}/${eventoId}/`) || archivo.includes('..'))) {
        throw new ErrorHttp(422, 'El archivo no corresponde a este evento.');
      }
      const { data, error } = await supabase.rpc('registrar_evento', { p_aliado: aliado.id, p_evento: eventoId, p_datos: datos, p_archivo: archivo });
      if (error) throw errorDeEvento(error.message) || new Error('registrar_evento falló');
      return res.status(201).json(data);
    }

    throw new ErrorHttp(400, 'Acción desconocida.');
  } catch (e) {
    return responderError(res, e);
  }
}
