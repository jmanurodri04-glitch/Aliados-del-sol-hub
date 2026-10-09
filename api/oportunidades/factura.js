// POST /api/oportunidades/factura — permiso de un solo uso para subir la factura al bucket privado (CLAUDE.md §4.5).
//
// El navegador sube el archivo directo a Supabase Storage con esta URL firmada (Vercel limita el cuerpo de las
// funciones a 4,5 MB y la factura puede pesar hasta 10 MB). La ruta queda en la carpeta del aliado de la sesión:
// {aliado_id}/{empresa_id}/{archivo}. Después, POST /api/oportunidades registra la oportunidad con esa ruta.
//
// Formulario público (`publico: true`, sin sesión): verifica el captcha, sube a publico/{empresa_id}/{archivo} y deja
// un permiso de un solo uso para registrar esa empresa (lib/referido-publico.js).

import { randomUUID } from 'node:crypto';
import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { aliadoDeLaSesion, cuerpoJson, ErrorHttp, responderError } from '../../lib/sesion.js';
import { prepararFacturaPublica } from '../../lib/referido-publico.js';

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

// `inyectado` solo lo usan las pruebas (cliente de Supabase, variables de entorno y fetch simulados).
export default async function handler(req, res, inyectado = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  try {
    const supabase = inyectado.supabase || crearClienteServidor();
    const cuerpo = cuerpoJson(req);
    const { nombre_archivo: nombre, tipo, tamano } = cuerpo;

    if (!TIPOS[tipo]) throw new ErrorHttp(422, 'La factura debe ser PDF, JPG o PNG.');
    if (!(Number(tamano) > 0) || Number(tamano) > TAMANO_MAXIMO) throw new ErrorHttp(422, 'La factura debe pesar máximo 10 MB.');

    if (cuerpo.publico === true) {
      const permiso = await prepararFacturaPublica(req, cuerpo, {
        supabase, entorno: inyectado.entorno || process.env, fetchImpl: inyectado.fetch, nombreArchivo: nombreSeguro(nombre, tipo)
      });
      return res.status(200).json(permiso);
    }

    const aliado = await aliadoDeLaSesion(req, supabase);

    const empresaId = randomUUID();
    const ruta = `${aliado.id}/${empresaId}/${nombreSeguro(nombre, tipo)}`;
    const { data, error } = await supabase.storage.from('facturas').createSignedUploadUrl(ruta);
    if (error || !data) throw new ErrorHttp(500, 'No pudimos preparar la subida de la factura. Intenta de nuevo.');

    return res.status(200).json({ empresa_id: empresaId, ruta: data.path, token: data.token });
  } catch (e) {
    return responderError(res, e);
  }
}
