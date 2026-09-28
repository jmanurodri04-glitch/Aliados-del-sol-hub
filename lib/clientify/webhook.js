// Flujo C (CLAUDE.md §7.1, §8): procesa un contacto u oportunidad de Clientify que cambió.
//   1. Vuelve a consultar Clientify (no se confía en el payload del webhook).
//   2. Resuelve la empresa: por el ID del contacto; si no existe y el contacto trae ID_aliado, es un lead del
//      formulario público (se crea, con la deduplicación del flujo B).
//   3. Deriva las variables (avance.js) con la oportunidad más avanzada y las aplica en la base
//      (public.aplicar_avance_clientify: datos crudos, "primer valor definitivo gana" y movimientos).
// La API no filtra oportunidades por contacto: se usan la del evento (o del escaneo) y la ya guardada de la
// empresa. El escaneo periódico (escanearOportunidades) encola las oportunidades nuevas o que cambiaron.
// Devuelve { resultado, avisos }. Los avisos se guardan en webhook_eventos; nunca llevan datos personales.

import { esEntornoDePruebas } from './aliados.js';
import { construirCatalogoFases, derivarAvance, elegirOportunidad, hitosDeOportunidad } from './avance.js';
import {
  ETIQUETA_PRUEBA, ETIQUETA_REFERIDO_PERFECTO, MARCA_CORREO_PRUEBA, leerContacto, leerOportunidad
} from './mapeo.js';

// Catálogo de fases: una consulta por cliente de Clientify (cada ejecución del cron crea uno).
const catalogos = new WeakMap();
export function catalogoFases(clientify) {
  if (!catalogos.has(clientify)) {
    const promesa = clientify.listarFases().then(construirCatalogoFases);
    promesa.catch(() => catalogos.delete(clientify));
    catalogos.set(clientify, promesa);
  }
  return catalogos.get(clientify);
}

// Errores de la base que no se reintentan: quedan como aviso para revisión.
const RECHAZOS = /^(aliado_inexistente|referido_duplicado|autorreferido):\s*/;

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

/**
 * @param {string} contactId
 * @param {object} contexto { supabase, clientify, entorno }
 * @param {{ oportunidad?: object }} opciones oportunidad ya consultada (evento u escaneo), en formato de la API
 */
export async function procesarContacto(contactId, { supabase, clientify, entorno }, { oportunidad: oportunidadBruta = null } = {}) {
  const bruto = await clientify.obtenerContacto(contactId);
  if (!bruto) return { resultado: 'eliminado', avisos: ['El contacto ya no existe en Clientify; el Hub conserva su historial'] };
  const contacto = leerContacto(bruto);

  let empresa = await consulta(
    supabase.from('empresas').select('id, clientify_deal_id').eq('clientify_contact_id', String(contactId)).maybeSingle(),
    'No se pudo buscar la empresa');

  if (!empresa) {
    // Contactos que no son referidos: el contacto de un aliado (flujo A) o contactos sin ID_aliado. No es un error.
    // Las etiquetas "aliado del sol hub" / "aliados del sol" NO sirven para esto: el formulario público las pone
    // en los referidos. El aliado se reconoce por el ID de su contacto (y su propio correo lo rechaza la base).
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
        telefono: contacto.telefono, correo: contacto.correo, ciudad: contacto.ciudad, subsector: contacto.subsector,
        valor_factura: contacto.valorFactura,
        es_perfecto: tieneEtiqueta(contacto, ETIQUETA_REFERIDO_PERFECTO)
      }
    });
    if (error) {
      if (RECHAZOS.test(error.message || '')) return { resultado: 'rechazado', avisos: [error.message.slice(0, 300)] };
      throw new Error(`No se pudo registrar el lead (${[error.code, error.message].filter(Boolean).join(': ').slice(0, 160)})`);
    }
    empresa = { id: data.empresa_id, clientify_deal_id: null };
  }

  // Oportunidades candidatas: la del evento y la guardada. Solo las de este contacto (todos los embudos cuentan);
  // se usa la más avanzada según los hitos de su fase.
  const candidatas = [];
  if (oportunidadBruta) candidatas.push(leerOportunidad(oportunidadBruta));
  if (empresa.clientify_deal_id && !candidatas.some((o) => o.id === String(empresa.clientify_deal_id))) {
    const guardada = await clientify.obtenerOportunidad(empresa.clientify_deal_id);
    if (guardada) candidatas.push(leerOportunidad(guardada));
  }
  const delContacto = candidatas.filter((o) => o.contactos.includes(String(contactId)));
  if (delContacto.length) {
    const catalogo = await catalogoFases(clientify);
    for (const o of delContacto) o.hitos = hitosDeOportunidad(o, catalogo);
  }
  const oportunidad = elegirOportunidad(delContacto);

  const actual = await consulta(
    supabase.from('avance_empresa').select('calificado, perfecto').eq('empresa_id', empresa.id).maybeSingle(),
    'No se pudo leer el avance') || {};

  const { variables, crudos, avisos } = derivarAvance({ contacto, oportunidad }, actual);
  // Sin oportunidad consultada no se borran los datos de la última conocida.
  if (!oportunidad) for (const k of ['fase_oportunidad', 'fase_oportunidad_num', 'estado_oportunidad', 'valor_oportunidad']) delete crudos[k];
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
    const r = await procesarContacto(id, contexto, { oportunidad: bruta });
    avisos.push(...r.avisos);
    movimientos.push(...(r.movimientos || []));
    if (r.resultado === 'actualizado') resultado = 'actualizado';
  }
  return { resultado, movimientos, avisos };
}
