// Flujo B (CLAUDE.md §8): oportunidad registrada en el Hub → Clientify.
//   1. Empresa en Clientify (se busca por nombre para no duplicarla) con los datos del referido.
//   2. Contacto vinculado a la empresa, con ID_aliado = codigo_aliado y la etiqueta "Referido perfecto"
//      o "Referido imperfecto" para que Clientify continúe su proceso.
//   3. La factura se adjunta a la ficha de la empresa (decisión del equipo). Va al final para que un fallo
//      del adjunto no deje al referido sin contacto.
// Es idempotente: los IDs ya creados se guardan aunque un paso falle, y en el reintento se buscan antes de crear.

import { ErrorClientify } from './cliente.js';
import { esEntornoDePruebas, separarNombre } from './aliados.js';
import {
  CAMPO_ID_ALIADO, ETIQUETA_PRUEBA, ETIQUETA_REFERIDO_IMPERFECTO, ETIQUETA_REFERIDO_PERFECTO, MARCA_CORREO_PRUEBA
} from './mapeo.js';

const formatoPesos = (valor) => '$ ' + Number(valor || 0).toLocaleString('es-CO') + ' COP';

/** Resumen para el equipo comercial (va en la descripción de la empresa y del contacto). */
export function resumenReferido(e) {
  return [
    `Referido desde el Hub Aliados del Sol por ${e.codigo_aliado}.`,
    `Sector: ${e.sector}${e.subsector ? ' / ' + e.subsector : ''}.`,
    e.ciudad ? `Ciudad: ${e.ciudad}.` : null,
    `Valor mensual de la factura de energía: ${formatoPesos(e.valor_factura)}.`,
    e.observaciones ? `Observaciones del aliado: ${e.observaciones}` : null
  ].filter(Boolean).join('\n');
}

export function etiquetasDelReferido(e, entorno) {
  return [e.es_perfecto ? ETIQUETA_REFERIDO_PERFECTO : ETIQUETA_REFERIDO_IMPERFECTO, ...(esEntornoDePruebas(entorno) ? [ETIQUETA_PRUEBA] : [])];
}

export function construirContactoReferido(e, entorno, urlEmpresa) {
  return {
    ...separarNombre(e.nombre_contacto),
    email: e.correo,
    phone: e.telefono,
    ...(e.cargo ? { title: e.cargo } : {}),
    company: urlEmpresa,
    description: resumenReferido(e),
    tags: etiquetasDelReferido(e, entorno),
    custom_fields: [{ field: CAMPO_ID_ALIADO, value: e.codigo_aliado }]
  };
}

/** Fuera de Production solo se sincronizan contactos de prueba, para no tocar leads reales (§10). */
export function validarEntornoReferido(e, entorno) {
  if (esEntornoDePruebas(entorno) && !String(e.correo || '').toLowerCase().includes(MARCA_CORREO_PRUEBA)) {
    throw new ErrorClientify(`Entorno de pruebas (${entorno}): solo se sincronizan contactos cuyo correo contenga "${MARCA_CORREO_PRUEBA}"`, { reintentable: false });
  }
}

const valorIdAliado = (contacto) =>
  ((contacto && contacto.custom_fields) || []).find((c) => c && c.field === CAMPO_ID_ALIADO)?.value || null;

/**
 * Sincroniza una oportunidad del Hub con Clientify. `descargarFactura()` devuelve { contenido, tipo } del bucket.
 * Devuelve { companyId, contactId, facturaSubida }. Si falla, el error lleva `parcial` con lo ya creado.
 */
export async function sincronizarEmpresa(e, { clientify, entorno, descargarFactura }) {
  validarEntornoReferido(e, entorno);
  const parcial = { companyId: e.clientify_company_id || null, contactId: e.clientify_contact_id || null, facturaSubida: !!e.factura_subida };

  try {
    // 1. Empresa
    let empresa = null;
    if (!parcial.companyId) {
      empresa = await clientify.buscarEmpresaPorNombre(e.empresa);
      if (!empresa) empresa = await clientify.crearEmpresa({ name: e.empresa, description: resumenReferido(e) });
      if (!empresa || empresa.id == null) throw new ErrorClientify('Clientify no devolvió el ID de la empresa');
      parcial.companyId = String(empresa.id);
    }
    const urlEmpresa = clientify.urlEmpresa(empresa || { id: parcial.companyId });

    // 2. Contacto vinculado a la empresa (antes que la factura: si el adjunto falla, el contacto ya tiene
    //    ID_aliado y su etiqueta, que es lo que dispara los flujos de Clientify y n8n; el reintento solo repite la factura).
    const { tags, ...datos } = construirContactoReferido(e, entorno, urlEmpresa);
    if (!parcial.contactId) {
      const existente = await clientify.buscarContactoPorCorreo(e.correo);
      if (existente && existente.id != null) {
        // El contacto ya estaba en Clientify (p. ej. llegó por otro canal). Si ya pertenece a otro aliado,
        // no se le cambia la atribución: lo revisa el equipo.
        const idAliadoActual = valorIdAliado(existente);
        if (idAliadoActual && idAliadoActual !== e.codigo_aliado) {
          throw new ErrorClientify(`El contacto ya existe en Clientify con otro ID_aliado (${idAliadoActual}); requiere revisión del equipo`, { reintentable: false });
        }
        parcial.contactId = String(existente.id);
        await clientify.actualizarContacto(parcial.contactId, { company: urlEmpresa, custom_fields: datos.custom_fields });
        for (const etiqueta of tags) {
          try { await clientify.agregarEtiqueta(parcial.contactId, etiqueta); } catch (err) {
            if (!(err instanceof ErrorClientify) || err.reintentable) throw err; // una etiqueta repetida (4xx) no es un error
          }
        }
      } else {
        const creado = await clientify.crearContacto({ ...datos, tags });
        if (!creado || creado.id == null) throw new ErrorClientify('Clientify no devolvió el ID del contacto creado');
        parcial.contactId = String(creado.id);
      }
    }

    // 3. Factura adjunta a la empresa
    if (e.factura_storage_path && !parcial.facturaSubida) {
      const { contenido, tipo } = await descargarFactura(e.factura_storage_path);
      await clientify.subirDocumentoEmpresa(parcial.companyId, { nombre: e.factura_nombre || 'factura', tipo, contenido });
      parcial.facturaSubida = true;
    }

    return parcial;
  } catch (err) {
    err.parcial = parcial;
    throw err;
  }
}
