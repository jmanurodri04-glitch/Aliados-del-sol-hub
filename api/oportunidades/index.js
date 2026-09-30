// POST /api/oportunidades — "Nueva oportunidad" desde el Hub (CLAUDE.md §7.2).
//
// 1. Valida la sesión (el aliado sale del token, nunca del formulario) y que la cuenta esté activa.
// 2. public.registrar_oportunidad valida y guarda empresa, factura y avance, y otorga los puntos, todo en una
//    transacción: o queda completo o no queda nada (con límite de 20 por hora, duplicados y autorreferidos).
// 3. Intenta sincronizar con Clientify en el momento (flujo B); si falla, la cola lo reintenta por cron.
// 4. Responde con los puntos otorgados y el saldo actualizado.

import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { crearClienteClientify } from '../../lib/clientify/cliente.js';
import { procesarEmpresas } from '../../lib/clientify/cola.js';
import { aliadoDeLaSesion, cuerpoJson, ErrorHttp, responderError } from '../../lib/sesion.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CAMPOS = ['empresa', 'sector', 'subsector', 'ciudad', 'nombre_contacto', 'cargo', 'telefono', 'correo',
  'valor_factura', 'observaciones', 'autorizacion_contacto'];

// Errores de la base (prefijo estable) → respuesta para el aliado.
const ERRORES = {
  aliado_no_activo: [403, 'Tu cuenta no está activa.'],
  limite_referidos: [429, 'Alcanzaste el máximo de 20 referidos por hora. Intenta de nuevo más tarde.'],
  referido_duplicado: [409, 'Este contacto ya fue referido al programa.'],
  autorreferido: [422, 'No puedes referirte a ti mismo.'],
  oportunidad_invalida: [422, null],
  factura_invalida: [422, null]
};

export function errorDeRegistro(mensaje) {
  const [codigo, ...resto] = String(mensaje || '').split(':');
  const regla = ERRORES[codigo.trim()];
  if (!regla) return null;
  const detalle = resto.join(':').trim();
  return new ErrorHttp(regla[0], regla[1] || (detalle ? detalle.charAt(0).toUpperCase() + detalle.slice(1) + '.' : 'Revisa los datos.'));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  let supabase;
  let porBorrar = null; // factura del aliado que se borra si el registro falla
  try {
    supabase = crearClienteServidor();
    const aliado = await aliadoDeLaSesion(req, supabase);
    const cuerpo = cuerpoJson(req);

    const empresaId = String(cuerpo.empresa_id || '');
    if (!UUID.test(empresaId)) throw new ErrorHttp(400, 'Solicitud inválida.');
    const datos = Object.fromEntries(CAMPOS.filter((k) => cuerpo.datos && cuerpo.datos[k] !== undefined).map((k) => [k, cuerpo.datos[k]]));

    let factura = null;
    if (cuerpo.factura && cuerpo.factura.ruta) {
      factura = { storage_path: String(cuerpo.factura.ruta), nombre_archivo: String(cuerpo.factura.nombre_archivo || '').slice(0, 200) || null };
      // Solo la carpeta del aliado de la sesión y de esta oportunidad; nunca se toca un archivo ajeno.
      if (!factura.storage_path.startsWith(`${aliado.id}/${empresaId}/`) || factura.storage_path.includes('..')) {
        throw new ErrorHttp(422, 'La factura no corresponde a esta oportunidad.');
      }
      porBorrar = factura.storage_path;
    }

    const { data: resultado, error } = await supabase.rpc('registrar_oportunidad', {
      p_aliado: aliado.id, p_empresa_id: empresaId, p_datos: datos, p_factura: factura
    });
    if (error) throw errorDeRegistro(error.message) || new Error('registrar_oportunidad falló');
    porBorrar = null; // quedó registrada: ya no se borra

    // Flujo B inmediato (mejor esfuerzo). Si Clientify falla o no está configurado, lo reintenta el cron.
    let clientify = 'pendiente';
    if (process.env.CLIENTIFY_API_KEY) {
      try {
        const r = await procesarEmpresas({
          supabase,
          clientify: crearClienteClientify({ apiKey: process.env.CLIENTIFY_API_KEY, urlBase: process.env.CLIENTIFY_API_URL || undefined }),
          entorno: process.env.VERCEL_ENV || 'development',
          empresaId,
          limite: 1
        });
        if (r.ok === 1) clientify = 'ok';
      } catch { /* queda en la cola */ }
    }

    return res.status(201).json({ ...resultado, clientify });
  } catch (e) {
    // Si el registro falló, se borra la factura que se alcanzó a subir.
    if (porBorrar && supabase) await supabase.storage.from('facturas').remove([porBorrar]).catch(() => {});
    return responderError(res, e);
  }
}
