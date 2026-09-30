// POST /api/oportunidades/factura — permiso de un solo uso para subir la factura al bucket privado (CLAUDE.md §4.5).
//
// El navegador sube el archivo directo a Supabase Storage con esta URL firmada (Vercel limita el cuerpo de las
// funciones a 4,5 MB y la factura puede pesar hasta 10 MB). La ruta queda en la carpeta del aliado de la sesión:
// {aliado_id}/{empresa_id}/{archivo}. Después, POST /api/oportunidades registra la oportunidad con esa ruta.

import { randomUUID } from 'node:crypto';
import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { aliadoDeLaSesion, cuerpoJson, ErrorHttp, responderError } from '../../lib/sesion.js';

const TIPOS = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const TAMANO_MAXIMO = 10 * 1024 * 1024;

/** Nombre de archivo seguro para Storage: sin tildes ni caracteres especiales, con la extensión del tipo real. */
export function nombreSeguro(nombre, tipo) {
  const base = String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'factura'}.${TIPOS[tipo]}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  try {
    const supabase = crearClienteServidor();
    const aliado = await aliadoDeLaSesion(req, supabase);
    const { nombre_archivo: nombre, tipo, tamano } = cuerpoJson(req);

    if (!TIPOS[tipo]) throw new ErrorHttp(422, 'La factura debe ser PDF, JPG o PNG.');
    if (!(Number(tamano) > 0) || Number(tamano) > TAMANO_MAXIMO) throw new ErrorHttp(422, 'La factura debe pesar máximo 10 MB.');

    const empresaId = randomUUID();
    const ruta = `${aliado.id}/${empresaId}/${nombreSeguro(nombre, tipo)}`;
    const { data, error } = await supabase.storage.from('facturas').createSignedUploadUrl(ruta);
    if (error || !data) throw new ErrorHttp(500, 'No pudimos preparar la subida de la factura. Intenta de nuevo.');

    return res.status(200).json({ empresa_id: empresaId, ruta: data.path, token: data.token });
  } catch (e) {
    return responderError(res, e);
  }
}
