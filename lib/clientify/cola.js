// Procesamiento de las colas de sincronización con Clientify (flujo A: aliados; flujo B: empresas).
// Lo usan el cron (/api/cron/clientify) y /api/oportunidades (sincronización inmediata de una empresa).
// En los logs y respuestas solo va el codigo_aliado: nunca correos, nombres, tokens ni aliados.id (§2, §10).

import { sincronizarAliado } from './aliados.js';
import { sincronizarEmpresa } from './empresas.js';
import { catalogoFases, procesarContacto, procesarOportunidad } from './webhook.js';
import { hitosDeOportunidad, valoresDelReferido } from './avance.js';
import { leerOportunidad } from './mapeo.js';

// El código y el mensaje de PostgREST no llevan datos personales y dicen la causa (p. ej. PGRST202, 42501).
const detalleDe = (error) => [error.code, error.message].filter(Boolean).join(': ').slice(0, 200);

// Clientify une un contacto nuevo con uno existente cuando comparten el celular, y devuelve el ID de ese otro
// contacto. Si ya pertenece a otro aliado (o a otro referido), la base lo rechaza por el índice único (23505).
const ID_REPETIDO = '23505';
const motivoAlRegistrar = (error, quien) => error && error.code === ID_REPETIDO
  ? `Clientify devolvió el contacto de otro ${quien} (probablemente comparten el celular); revisa ese contacto en Clientify`
  : 'Sincronizado en Clientify pero no se pudo registrar el resultado';

/** Descarga la factura del bucket privado para adjuntarla en Clientify. */
export function descargadorDeFacturas(supabase) {
  return async (ruta) => {
    const { data, error } = await supabase.storage.from('facturas').download(ruta);
    if (error || !data) throw new Error('No se pudo leer la factura del almacenamiento');
    return { contenido: Buffer.from(await data.arrayBuffer()), tipo: data.type || 'application/octet-stream' };
  };
}

export async function procesarAliados({ supabase, clientify, entorno, limite = 5, seguir = () => true }) {
  const resumen = { procesados: 0, ok: 0, errores: 0, pospuestos: 0, detalle: [] };
  const { data: lote, error } = await supabase.rpc('clientify_reclamar_aliados', { p_limite: limite });
  if (error) throw new Error('No se pudo leer la cola de aliados (' + detalleDe(error) + ')');

  for (const aliado of lote || []) {
    // Lo que no alcance a procesarse queda prestado 10 minutos y se toma en la siguiente ejecución.
    if (!seguir()) { resumen.pospuestos++; continue; }
    resumen.procesados++;
    try {
      const { contactId, accion } = await sincronizarAliado(aliado, { clientify, entorno });
      const { error: e } = await supabase.rpc('clientify_registrar_resultado', { p_aliado: aliado.aliado_id, p_contact_id: contactId, p_error: null });
      if (e) throw new Error(motivoAlRegistrar(e, 'aliado'));
      resumen.ok++;
      resumen.detalle.push({ codigo_aliado: aliado.codigo_aliado, accion });
    } catch (e) {
      const motivo = e.message || 'Error desconocido';
      await supabase.rpc('clientify_registrar_resultado', { p_aliado: aliado.aliado_id, p_contact_id: null, p_error: motivo });
      resumen.errores++;
      resumen.detalle.push({ codigo_aliado: aliado.codigo_aliado, error: motivo });
    }
  }
  return resumen;
}

export async function procesarEmpresas({ supabase, clientify, entorno, limite = 5, empresaId = null, seguir = () => true }) {
  const resumen = { procesados: 0, ok: 0, errores: 0, pospuestos: 0, detalle: [] };
  const { data: lote, error } = await supabase.rpc('clientify_reclamar_empresas', { p_limite: limite, p_empresa: empresaId });
  if (error) throw new Error('No se pudo leer la cola de empresas (' + detalleDe(error) + ')');
  const descargarFactura = descargadorDeFacturas(supabase);

  for (const empresa of lote || []) {
    if (!seguir()) { resumen.pospuestos++; continue; }
    resumen.procesados++;
    try {
      const r = await sincronizarEmpresa(empresa, { clientify, entorno, descargarFactura });
      const { error: e } = await supabase.rpc('clientify_registrar_resultado_empresa', {
        p_empresa: empresa.empresa_id, p_company_id: r.companyId, p_contact_id: r.contactId, p_factura_subida: r.facturaSubida, p_error: null
      });
      if (e) throw Object.assign(new Error(motivoAlRegistrar(e, 'referido')), { parcial: e.code === ID_REPETIDO ? { ...r, contactId: null } : r });
      resumen.ok++;
      resumen.detalle.push({ codigo_aliado: empresa.codigo_aliado, empresa: 'ok' });
    } catch (e) {
      const p = e.parcial || {};
      const motivo = e.message || 'Error desconocido';
      await supabase.rpc('clientify_registrar_resultado_empresa', {
        p_empresa: empresa.empresa_id, p_company_id: p.companyId || null, p_contact_id: p.contactId || null,
        p_factura_subida: !!p.facturaSubida, p_error: motivo
      });
      resumen.errores++;
      resumen.detalle.push({ codigo_aliado: empresa.codigo_aliado, error: motivo });
    }
  }
  return resumen;
}

/** Flujo C: contactos y oportunidades que cambiaron en Clientify (webhook o conciliación). */
export async function procesarEntidades({ supabase, clientify, entorno, limite = 25, seguir = () => true }) {
  const resumen = { procesados: 0, ok: 0, errores: 0, pospuestos: 0, detalle: [] };
  const { data: lote, error } = await supabase.rpc('clientify_reclamar_entidades', { p_limite: limite });
  if (error) throw new Error('No se pudo leer la cola de eventos de Clientify (' + detalleDe(error) + ')');

  for (const item of lote || []) {
    if (!seguir()) { resumen.pospuestos++; continue; }
    resumen.procesados++;
    const clave = { p_entidad: item.entidad, p_entidad_id: item.entidad_id, p_reclamado_at: item.reclamado_at };
    try {
      const procesar = item.entidad === 'oportunidad' ? procesarOportunidad : procesarContacto;
      const r = await procesar(item.entidad_id, { supabase, clientify, entorno });
      const aviso = r.avisos.length ? r.avisos.join(' · ').slice(0, 1000) : null;
      // Lo que no es del programa no se guarda: se borra el payload del evento (datos personales ajenos).
      const { error: e } = await supabase.rpc('clientify_resultado_entidad', {
        ...clave, p_error: null, p_aviso: aviso, p_descartar: r.resultado === 'ignorado'
      });
      if (e) throw new Error('Procesado pero no se pudo registrar el resultado');
      resumen.ok++;
      resumen.detalle.push({ entidad: item.entidad, id: item.entidad_id, resultado: r.resultado, movimientos: r.movimientos || [], ...(aviso ? { aviso } : {}) });
    } catch (e) {
      const motivo = e.message || 'Error desconocido';
      await supabase.rpc('clientify_resultado_entidad', { ...clave, p_error: motivo, p_aviso: null, p_descartar: false });
      resumen.errores++;
      resumen.detalle.push({ entidad: item.entidad, id: item.entidad_id, error: motivo });
    }
  }
  return resumen;
}

const MAX_OPORTUNIDADES = 100 * 100; // listarOportunidades: 100 páginas de 100

/**
 * Escaneo de oportunidades (la API no filtra por contacto y los webhooks pueden perderse): recorre las
 * oportunidades de todos los embudos y
 *   1. encola las de contactos referidos que son nuevas con más hitos que los ya alcanzados, o que son la
 *      guardada y cambiaron de fase o estado;
 *   2. actualiza los valores del referido (cotizado, pipeline originado y potencia), que suman TODAS sus
 *      oportunidades de proyectos.
 * Lo usa la conciliación (cada hora).
 */
export async function escanearOportunidades({ supabase, clientify }) {
  const catalogo = await catalogoFases(clientify);
  const brutas = await clientify.listarOportunidades();
  const oportunidades = brutas.map(leerOportunidad);
  for (const o of oportunidades) o.hitos = hitosDeOportunidad(o, catalogo);
  const contactos = [...new Set(oportunidades.flatMap((o) => o.contactos))];

  const empresas = new Map();
  for (let i = 0; i < contactos.length; i += 200) {
    const { data, error } = await supabase.from('empresas')
      .select('clientify_contact_id, clientify_deal_id, avance_empresa(fase_oportunidad, estado_oportunidad, oportunidad_tecnica, propuesta_comercial, negocio_cerrado)')
      .in('clientify_contact_id', contactos.slice(i, i + 200));
    if (error) throw new Error('No se pudieron leer las empresas (' + detalleDe(error) + ')');
    for (const e of data || []) {
      const avance = Array.isArray(e.avance_empresa) ? e.avance_empresa[0] : e.avance_empresa;
      const a = avance || {};
      const nivel = ['oportunidad_tecnica', 'propuesta_comercial', 'negocio_cerrado'].filter((h) => a[h] === 'si').length;
      empresas.set(String(e.clientify_contact_id), { dealId: e.clientify_deal_id, nivel, ...a });
    }
  }

  // Valores por referido: solo oportunidades de embudos de proyectos (los que tienen alguna fase de hito).
  const porContacto = new Map();
  for (const o of oportunidades) {
    const fase = o.faseId ? catalogo.fases.get(String(o.faseId)) : null;
    if (!fase || !catalogo.hitos.has(fase.embudo)) continue;
    for (const c of o.contactos) if (empresas.has(c)) porContacto.set(c, [...(porContacto.get(c) || []), o]);
  }
  const valores = [...porContacto].map(([contactId, lista]) => ({ contact_id: contactId, ...valoresDelReferido(lista) }));
  const { data: actualizados, error: errorValores } = await supabase.rpc('clientify_actualizar_valores', {
    p_valores: valores, p_completo: brutas.length < MAX_OPORTUNIDADES
  });
  if (errorValores) throw new Error('No se pudieron guardar los valores (' + detalleDe(errorValores) + ')');

  let encoladas = 0;
  for (const o of oportunidades) {
    const e = o.contactos.map((c) => empresas.get(c)).find(Boolean);
    if (!e) continue;
    const cambio = String(o.id) === String(e.dealId)
      ? o.fase !== e.fase_oportunidad || o.estado !== e.estado_oportunidad
      : ((o.hitos || {}).nivel ?? 0) > e.nivel;
    if (!cambio) continue;
    const { error } = await supabase.rpc('clientify_encolar_entidad', {
      p_entidad: 'oportunidad', p_entidad_id: o.id, p_demora_segundos: 0, p_origen: 'conciliacion'
    });
    if (error) throw new Error('No se pudo encolar la oportunidad (' + detalleDe(error) + ')');
    encoladas++;
  }
  return { revisadas: oportunidades.length, encoladas, valores_actualizados: actualizados ?? 0 };
}
