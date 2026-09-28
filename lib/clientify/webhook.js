// Flujo C (CLAUDE.md §7.1, §8): procesa un contacto u oportunidad de Clientify que cambió.
//   1. Vuelve a consultar Clientify (no se confía en el payload del webhook).
//   2. Resuelve la empresa: por el ID del contacto; si no existe y el contacto trae ID_aliado, es un lead del
//      formulario público (se crea, con la deduplicación del flujo B).
//   3. Deriva las variables (avance.js) con la oportunidad más avanzada y las aplica en la base
//      (public.aplicar_avance_clientify: datos crudos, "primer valor definitivo gana" y movimientos).
// Devuelve { resultado, avisos }. Los avisos se guardan en webhook_eventos; nunca llevan datos personales.

import { esEntornoDePruebas } from './aliados.js';
import { derivarAvance, elegirOportunidad } from './avance.js';
import {
  ETIQUETA_ALIADO, ETIQUETA_PRUEBA, ETIQUETA_REFERIDO_PERFECTO, MARCA_CORREO_PRUEBA, leerContacto, leerOportunidad
} from './mapeo.js';

// Errores de la base que no se reintentan: quedan como aviso para revisión.
const RECHAZOS = /^(aliado_inexistente|referido_duplicado):\s*/;

async function consulta(promesa, mensaje) {
  const { data, error } = await promesa;
  if (error) throw new Error(`${mensaje} (${[error.code, error.message].filter(Boolean).join(': ').slice(0, 160)})`);
  return data;
}

const tieneEtiqueta = (c, nombre) => c.etiquetas.some((e) => e.trim().toLowerCase() === nombre.toLowerCase());

/** ¿Este contacto se ignora en este entorno? Clientify es uno solo para pruebas y producción (§10). */
function ignorarPorEntorno(c, entorno) {
  if (esEntornoDePruebas(entorno)) {
    return String(c.correo || '').toLowerCase().includes(MARCA_CORREO_PRUEBA) ? null
      : `Entorno de pruebas (${entorno}): se ignoran contactos sin "${MARCA_CORREO_PRUEBA}" en el correo`;
  }
  return tieneEtiqueta(c, ETIQUETA_PRUEBA) ? `Contacto de pruebas (${ETIQUETA_PRUEBA}): se ignora en producción` : null;
}

export async function procesarContacto(contactId, { supabase, clientify, entorno }) {
  const bruto = await clientify.obtenerContacto(contactId);
  if (!bruto) return { resultado: 'eliminado', avisos: ['El contacto ya no existe en Clientify; el Hub conserva su historial'] };
  const contacto = leerContacto(bruto);

  let empresa = await consulta(
    supabase.from('empresas').select('id').eq('clientify_contact_id', String(contactId)).maybeSingle(),
    'No se pudo buscar la empresa');

  if (!empresa) {
    // Contactos que no son referidos: aliados (flujo A) o contactos sin ID_aliado. No es un error.
    if (tieneEtiqueta(contacto, ETIQUETA_ALIADO)) return { resultado: 'ignorado', avisos: [] };
    const esAliado = await consulta(
      supabase.from('aliados').select('id').eq('clientify_contact_id', String(contactId)).maybeSingle(),
      'No se pudo verificar el contacto');
    if (esAliado || !contacto.idAliado) return { resultado: 'ignorado', avisos: [] };

    const motivo = ignorarPorEntorno(contacto, entorno);
    if (motivo) return { resultado: 'ignorado', avisos: [motivo] };

    // Lead del formulario público "Refiere tu empresa" (§7.1).
    const { data, error } = await supabase.rpc('clientify_registrar_lead', {
      p_codigo_aliado: contacto.idAliado,
      p_contact_id: String(contactId),
      p_datos: {
        empresa: contacto.empresa, nombre_contacto: contacto.nombre, cargo: contacto.cargo,
        telefono: contacto.telefono, correo: contacto.correo,
        es_perfecto: tieneEtiqueta(contacto, ETIQUETA_REFERIDO_PERFECTO)
      }
    });
    if (error) {
      if (RECHAZOS.test(error.message || '')) return { resultado: 'rechazado', avisos: [error.message.slice(0, 300)] };
      throw new Error(`No se pudo registrar el lead (${[error.code, error.message].filter(Boolean).join(': ').slice(0, 160)})`);
    }
    empresa = { id: data.empresa_id };
  }

  // Oportunidades: solo las que de verdad están vinculadas a este contacto; se usa la más avanzada.
  const oportunidades = (await clientify.oportunidadesDeContacto(contactId))
    .map(leerOportunidad)
    .filter((o) => o.contactos.includes(String(contactId)));
  const oportunidad = elegirOportunidad(oportunidades);

  const actual = await consulta(
    supabase.from('avance_empresa').select('calificado, perfecto').eq('empresa_id', empresa.id).maybeSingle(),
    'No se pudo leer el avance') || {};

  const { variables, crudos, avisos } = derivarAvance({ contacto, oportunidad }, actual);
  const r = await consulta(supabase.rpc('aplicar_avance_clientify', {
    p_empresa: empresa.id, p_crudos: crudos, p_variables: variables, p_deal_id: oportunidad ? oportunidad.id : null
  }), 'No se pudo aplicar el avance');

  for (const c of (r && r.conflictos) || []) {
    avisos.push(`Conflicto: Clientify cambió ${c.variable} de "${c.hub}" a "${c.clientify}"; lo resuelve un admin`);
  }
  const movimientos = ((r && r.movimientos) || []).filter((m) => m.registrado).map((m) => m.motivo);
  return { resultado: 'actualizado', movimientos, avisos };
}

export async function procesarOportunidad(dealId, contexto) {
  const { supabase, clientify } = contexto;
  const bruta = await clientify.obtenerOportunidad(dealId);
  let contactos;
  if (bruta) {
    contactos = leerOportunidad(bruta).contactos;
  } else {
    // Oportunidad eliminada: se recalcula la empresa que la tenía, con las oportunidades que queden.
    const empresa = await consulta(
      supabase.from('empresas').select('clientify_contact_id').eq('clientify_deal_id', String(dealId)).maybeSingle(),
      'No se pudo buscar la empresa de la oportunidad');
    contactos = empresa && empresa.clientify_contact_id ? [empresa.clientify_contact_id] : [];
  }
  if (!contactos.length) return { resultado: 'ignorado', avisos: bruta ? ['La oportunidad no tiene un contacto vinculado'] : [] };

  const avisos = [];
  const movimientos = [];
  let resultado = 'ignorado';
  for (const id of contactos) {
    const r = await procesarContacto(id, contexto);
    avisos.push(...r.avisos);
    movimientos.push(...(r.movimientos || []));
    if (r.resultado === 'actualizado') resultado = 'actualizado';
  }
  return { resultado, movimientos, avisos };
}
