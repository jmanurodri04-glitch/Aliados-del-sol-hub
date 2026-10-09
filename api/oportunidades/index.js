// POST /api/oportunidades — "Nueva oportunidad" desde el Hub (CLAUDE.md §7.2).
//
// 1. Valida la sesión (el aliado sale del token, nunca del formulario) y que la cuenta esté activa.
// 2. public.registrar_oportunidad valida y guarda empresa, factura y avance, y otorga los puntos, todo en una
//    transacción: o queda completo o no queda nada (con límite de 20 por hora, duplicados y autorreferidos).
// 3. Intenta sincronizar con Clientify en el momento (flujo B); si falla, la cola lo reintenta por cron.
// 4. Envía el correo «Confirmación de empresa referida» (con la invitación al MEDDPICC si aplica) con Resend; si falla,
//    el cron lo reintenta y el panel lo muestra en «Correos no enviados». Corre a la vez que Clientify.
// 5. Responde con los puntos otorgados y el saldo actualizado.
//
// Formulario público (`publico: true`, sin sesión): el aliado se busca por `correo_aliado` con captcha, límite por
// conexión y mensajes ambiguos (lib/referido-publico.js). Responde solo { es_perfecto, puntos, clientify }.

import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { crearClienteClientify } from '../../lib/clientify/cliente.js';
import { procesarEmpresas } from '../../lib/clientify/cola.js';
import { enviarCorreoAhora } from '../../lib/correo/cola.js';
import { enviarAvisoAhora } from '../../lib/n8n/avisos.js';
import { aliadoDeLaSesion, cuerpoJson, ErrorHttp, responderError } from '../../lib/sesion.js';
import { registrarPublico } from '../../lib/referido-publico.js';

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

// Flujo B inmediato (mejor esfuerzo). Si Clientify falla o no está configurado, lo reintenta el cron.
async function sincronizarAhora(supabase, empresaId, entorno) {
  if (!entorno.CLIENTIFY_API_KEY) return 'pendiente';
  try {
    const r = await procesarEmpresas({
      supabase,
      clientify: crearClienteClientify({ apiKey: entorno.CLIENTIFY_API_KEY, urlBase: entorno.CLIENTIFY_API_URL || undefined }),
      entorno: entorno.VERCEL_ENV || 'development',
      empresaId,
      limite: 1
    });
    return r.ok === 1 ? 'ok' : 'pendiente';
  } catch {
    return 'pendiente'; // queda en la cola
  }
}

// Clientify y el correo en paralelo (ninguno hace fallar el registro). El resultado del correo no se devuelve.
// El aviso a n8n (§7.4; perfectos e imperfectos, cada uno a su webhook) va después de Clientify, porque n8n busca el
// lead allí; si el referido aún no llegó a Clientify, la cola no devuelve nada y lo envía el cron.
async function despuesDeRegistrar(supabase, empresaId, entorno, fetchImpl) {
  const [clientify] = await Promise.all([
    sincronizarAhora(supabase, empresaId, entorno).then(async (r) => {
      if (r === 'ok') await enviarAvisoAhora(supabase, empresaId, entorno, fetchImpl || fetch);
      return r;
    }),
    enviarCorreoAhora(supabase, empresaId, entorno, fetchImpl || fetch)
  ]);
  return clientify;
}

// `inyectado` solo lo usan las pruebas (cliente de Supabase, variables de entorno y fetch simulados).
export default async function handler(req, res, inyectado = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  let supabase;
  let porBorrar = null; // factura que se borra si el registro falla
  try {
    supabase = inyectado.supabase || crearClienteServidor();
    const entorno = inyectado.entorno || process.env;
    const cuerpo = cuerpoJson(req);
    const publico = cuerpo.publico === true;
    const aliado = publico ? null : await aliadoDeLaSesion(req, supabase);

    const empresaId = String(cuerpo.empresa_id || '');
    if (!UUID.test(empresaId)) throw new ErrorHttp(400, 'Solicitud inválida.');
    const datos = Object.fromEntries(CAMPOS.filter((k) => cuerpo.datos && cuerpo.datos[k] !== undefined).map((k) => [k, cuerpo.datos[k]]));

    let factura = null;
    if (cuerpo.factura && cuerpo.factura.ruta) {
      factura = { storage_path: String(cuerpo.factura.ruta), nombre_archivo: String(cuerpo.factura.nombre_archivo || '').slice(0, 200) || null };
      // Solo la carpeta de esta oportunidad (y del aliado de la sesión); nunca se toca un archivo ajeno.
      const carpeta = publico ? `publico/${empresaId}/` : `${aliado.id}/${empresaId}/`;
      if (!factura.storage_path.startsWith(carpeta) || factura.storage_path.includes('..')) {
        throw new ErrorHttp(422, 'La factura no corresponde a esta oportunidad.');
      }
      porBorrar = factura.storage_path;
    }

    if (publico) {
      const resultado = await registrarPublico(req, cuerpo, { supabase, entorno, fetchImpl: inyectado.fetch, empresaId, datos, factura });
      porBorrar = null;
      return res.status(201).json({ ...resultado, clientify: await despuesDeRegistrar(supabase, empresaId, entorno, inyectado.fetch) });
    }

    const { data: resultado, error } = await supabase.rpc('registrar_oportunidad', {
      p_aliado: aliado.id, p_empresa_id: empresaId, p_datos: datos, p_factura: factura
    });
    if (error) throw errorDeRegistro(error.message) || new Error('registrar_oportunidad falló');
    porBorrar = null; // quedó registrada: ya no se borra

    return res.status(201).json({ ...resultado, clientify: await despuesDeRegistrar(supabase, empresaId, entorno, inyectado.fetch) });
  } catch (e) {
    // Si el registro falló, se borra la factura que se alcanzó a subir.
    if (porBorrar && supabase) await supabase.storage.from('facturas').remove([porBorrar]).catch(() => {});
    return responderError(res, e);
  }
}
