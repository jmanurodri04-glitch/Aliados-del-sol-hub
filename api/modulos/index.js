// POST /api/modulos — el aliado completó un curso de la Academy (CLAUDE.md §5.3).
//
// 1. Valida la sesión (el aliado sale del token, nunca del cuerpo) y que la cuenta esté activa.
// 2. public.completar_modulo registra el módulo una sola vez y otorga sus puntos si caben en el tope
//    de 20 por mes; si no caben, la recompensa queda pendiente para el mes siguiente.
// 3. Responde el estado de la recompensa para que el Hub avise al aliado.

import { crearClienteServidor } from '../../lib/supabase-servidor.js';
import { aliadoDeLaSesion, cuerpoJson, ErrorHttp, responderError } from '../../lib/sesion.js';

const CODIGO = /^[a-z0-9_-]{1,80}$/; // igual que modulos.codigo (los cursos de la Academy usan el slug del título)

// Errores de la base (prefijo estable) → respuesta para el aliado.
const ERRORES = {
  aliado_no_activo: [403, 'Tu cuenta no está activa.'],
  modulo_inexistente: [404, 'Este curso no está disponible.']
};

export function errorDeModulo(mensaje) {
  const codigo = String(mensaje || '').split(':')[0].trim();
  const regla = ERRORES[codigo];
  return regla ? new ErrorHttp(regla[0], regla[1]) : null;
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
    const codigo = String(cuerpoJson(req).codigo || '').trim().toLowerCase();
    if (!CODIGO.test(codigo)) throw new ErrorHttp(400, 'Solicitud inválida.');

    const { data, error } = await supabase.rpc('completar_modulo', { p_aliado: aliado.id, p_codigo: codigo });
    if (error) throw errorDeModulo(error.message) || new Error('completar_modulo falló');

    const { data: saldo } = await supabase
      .from('aliados').select('puntos_disponibles, puntos_nivel, nivel').eq('id', aliado.id).maybeSingle();

    return res.status(200).json({
      codigo: data.codigo,
      nuevo: data.nuevo,
      puntos: data.puntos,
      recompensa_estado: data.recompensa_estado,
      ...(saldo || {})
    });
  } catch (e) {
    return responderError(res, e);
  }
}
