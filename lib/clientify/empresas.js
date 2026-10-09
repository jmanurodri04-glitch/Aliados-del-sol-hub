// Flujo B (CLAUDE.md §8): oportunidad registrada en el Hub → Clientify.
//   1. Empresa en Clientify (se busca por nombre para no duplicarla). Si el Hub la crea, lleva sector,
//      ciudad y el resumen del referido en la descripción; una empresa que ya existía no se modifica.
//   2. Contacto vinculado a la empresa por su NOMBRE (el campo `company` del contacto es texto: con la URL
//      de la empresa, Clientify creaba otra empresa llamada como la URL), con ID_aliado, la etiqueta
//      "Referido perfecto" o "Referido imperfecto", ciudad, subsector y valor de la factura en los mismos
//      campos que usaba el antiguo formulario de Clientify.
//   3. Factura: la API no permite subir archivos (403; lo confirmó el soporte de Clientify), así que se agrega
//      a la descripción de la empresa un enlace privado de descarga de 180 días (decisión del equipo). Va al
//      final para que un fallo no deje al referido sin contacto.
// Es idempotente: los IDs ya creados se guardan aunque un paso falle, y en el reintento se buscan antes de crear.

import { ErrorClientify } from './cliente.js';
import { esEntornoDePruebas, separarNombre } from './aliados.js';
import {
  CAMPO_ID_ALIADO, CAMPO_SUBSECTOR_CONTACTO, CAMPO_VALOR_FACTURA_CONTACTO, ETIQUETA_PRUEBA, ETIQUETA_REFERIDO_IMPERFECTO,
  ETIQUETA_REFERIDO_PERFECTO, MARCA_CORREO_PRUEBA, PAIS_CLIENTIFY
} from './mapeo.js';

const formatoPesos = (valor) => '$ ' + Number(valor || 0).toLocaleString('es-CO') + ' COP';

/** Días que vale el enlace de la factura que se deja en Clientify (decisión del equipo). */
export const DIAS_ENLACE_FACTURA = 180;
/** Marca del párrafo de la factura en la descripción de la empresa (evita repetirlo en un reintento). */
export const MARCA_FACTURA = 'Factura de energía del referido';

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

/** Párrafo con el enlace de la factura y el aviso de cuidado para el equipo (datos personales, Ley 1581). */
export function notaFactura(e, url) {
  return [
    `${MARCA_FACTURA} (${e.factura_nombre || 'factura'}): ${url}`,
    `Enlace privado, válido ${DIAS_ENLACE_FACTURA} días. No lo copies ni lo compartas: descarga la factura y guárdala con el cuidado que exige la política de tratamiento de datos.`
  ].join('\n');
}

export function etiquetasDelReferido(e, entorno) {
  return [e.es_perfecto ? ETIQUETA_REFERIDO_PERFECTO : ETIQUETA_REFERIDO_IMPERFECTO, ...(esEntornoDePruebas(entorno) ? [ETIQUETA_PRUEBA] : [])];
}

const direccion = (e) => (e.ciudad ? [{ city: e.ciudad, country: PAIS_CLIENTIFY }] : null);

export function construirEmpresaReferido(e) {
  return {
    name: e.empresa,
    company_sector: e.subsector ? `${e.sector} / ${e.subsector}` : e.sector,
    description: resumenReferido(e),
    ...(direccion(e) ? { addresses: direccion(e) } : {})
  };
}

export function construirContactoReferido(e, entorno) {
  return {
    ...separarNombre(e.nombre_contacto),
    email: e.correo,
    phone: e.telefono,
    ...(e.cargo ? { title: e.cargo } : {}),
    company: e.empresa,
    contact_sector: e.sector,
    ...(direccion(e) ? { addresses: direccion(e) } : {}),
    description: resumenReferido(e),
    tags: etiquetasDelReferido(e, entorno),
    custom_fields: [
      { field: CAMPO_ID_ALIADO, value: e.codigo_aliado },
      ...(e.subsector ? [{ field: CAMPO_SUBSECTOR_CONTACTO, value: e.subsector }] : []),
      ...(e.valor_factura != null ? [{ field: CAMPO_VALOR_FACTURA_CONTACTO, value: String(Math.round(Number(e.valor_factura))) }] : [])
    ]
  };
}

/** Fuera de Production solo se sincronizan contactos de prueba, para no tocar leads reales (§10). */
export function validarEntornoReferido(e, entorno) {
  if (esEntornoDePruebas(entorno) && !String(e.correo || '').toLowerCase().includes(MARCA_CORREO_PRUEBA)) {
    throw new ErrorClientify(`Entorno de pruebas (${entorno}): solo se sincronizan contactos cuyo correo contenga "${MARCA_CORREO_PRUEBA}"`, { reintentable: false });
  }
}

// Si Clientify rechaza un dato opcional (400, p. ej. el formato de la dirección), se reintenta sin él para que
// el referido no se quede sin empresa o sin contacto.
async function conRespaldo(crear, datos, opcionales) {
  try {
    return await crear(datos);
  } catch (err) {
    if (!(err instanceof ErrorClientify) || err.status !== 400 || !opcionales.some((k) => k in datos)) throw err;
    const reducido = { ...datos };
    for (const k of opcionales) delete reducido[k];
    return crear(reducido);
  }
}

const valorIdAliado = (contacto) =>
  ((contacto && contacto.custom_fields) || []).find((c) => c && c.field === CAMPO_ID_ALIADO)?.value || null;

/**
 * Sincroniza una oportunidad del Hub con Clientify. `enlaceFactura(ruta, nombre)` devuelve una URL firmada de
 * descarga del bucket. Devuelve { companyId, contactId, facturaSubida }. Si falla, el error lleva `parcial`.
 */
export async function sincronizarEmpresa(e, { clientify, entorno, enlaceFactura }) {
  validarEntornoReferido(e, entorno);
  const parcial = { companyId: e.clientify_company_id || null, contactId: e.clientify_contact_id || null, facturaSubida: !!e.factura_subida };

  try {
    // 1. Empresa
    if (!parcial.companyId) {
      let empresa = await clientify.buscarEmpresaPorNombre(e.empresa);
      if (!empresa) empresa = await conRespaldo((d) => clientify.crearEmpresa(d), construirEmpresaReferido(e), ['addresses', 'company_sector']);
      if (!empresa || empresa.id == null) throw new ErrorClientify('Clientify no devolvió el ID de la empresa');
      parcial.companyId = String(empresa.id);
    }

    // 2. Contacto vinculado a la empresa (antes que la factura: si el enlace falla, el contacto ya tiene
    //    ID_aliado y su etiqueta, que es lo que dispara los flujos de Clientify y n8n).
    const { tags, ...datos } = construirContactoReferido(e, entorno);
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
        await clientify.actualizarContacto(parcial.contactId, { company: datos.company, custom_fields: datos.custom_fields });
        for (const etiqueta of tags) {
          try { await clientify.agregarEtiqueta(parcial.contactId, etiqueta); } catch (err) {
            if (!(err instanceof ErrorClientify) || err.reintentable) throw err; // una etiqueta repetida (4xx) no es un error
          }
        }
      } else {
        const creado = await conRespaldo((d) => clientify.crearContacto(d), { ...datos, tags }, ['addresses', 'contact_sector']);
        if (!creado || creado.id == null) throw new ErrorClientify('Clientify no devolvió el ID del contacto creado');
        parcial.contactId = String(creado.id);
      }
    }

    // 3. Enlace de la factura en la descripción de la empresa (se agrega al final; no borra lo que había).
    if (e.factura_storage_path && !parcial.facturaSubida) {
      const url = await enlaceFactura(e.factura_storage_path, e.factura_nombre || 'factura');
      const actual = await clientify.obtenerEmpresa(parcial.companyId);
      const descripcion = (actual && actual.description) || '';
      if (!descripcion.includes(MARCA_FACTURA)) {
        await clientify.actualizarEmpresa(parcial.companyId, { description: [descripcion.trim(), notaFactura(e, url)].filter(Boolean).join('\n\n') });
      }
      parcial.facturaSubida = true;
    }

    return parcial;
  } catch (err) {
    err.parcial = parcial;
    throw err;
  }
}
