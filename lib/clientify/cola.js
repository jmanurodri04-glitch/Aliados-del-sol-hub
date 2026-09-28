// Procesamiento de las colas de sincronización con Clientify (flujo A: aliados; flujo B: empresas).
// Lo usan el cron (/api/cron/clientify) y /api/oportunidades (sincronización inmediata de una empresa).
// En los logs y respuestas solo va el codigo_aliado: nunca correos, nombres, tokens ni aliados.id (§2, §10).

import { sincronizarAliado } from './aliados.js';
import { sincronizarEmpresa } from './empresas.js';

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
  if (error) throw new Error('No se pudo leer la cola de aliados');

  for (const aliado of lote || []) {
    // Lo que no alcance a procesarse queda prestado 10 minutos y se toma en la siguiente ejecución.
    if (!seguir()) { resumen.pospuestos++; continue; }
    resumen.procesados++;
    try {
      const { contactId, accion } = await sincronizarAliado(aliado, { clientify, entorno });
      const { error: e } = await supabase.rpc('clientify_registrar_resultado', { p_aliado: aliado.aliado_id, p_contact_id: contactId, p_error: null });
      if (e) throw new Error('Sincronizado en Clientify pero no se pudo registrar el resultado');
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
  if (error) throw new Error('No se pudo leer la cola de empresas');
  const descargarFactura = descargadorDeFacturas(supabase);

  for (const empresa of lote || []) {
    if (!seguir()) { resumen.pospuestos++; continue; }
    resumen.procesados++;
    try {
      const r = await sincronizarEmpresa(empresa, { clientify, entorno, descargarFactura });
      const { error: e } = await supabase.rpc('clientify_registrar_resultado_empresa', {
        p_empresa: empresa.empresa_id, p_company_id: r.companyId, p_contact_id: r.contactId, p_factura_subida: r.facturaSubida, p_error: null
      });
      if (e) throw Object.assign(new Error('Sincronizado en Clientify pero no se pudo registrar el resultado'), { parcial: r });
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
