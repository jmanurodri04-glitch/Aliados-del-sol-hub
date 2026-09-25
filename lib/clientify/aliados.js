// Flujo A (CLAUDE.md §8): aliado aprobado → contacto en Clientify con la etiqueta "Aliado del Sol",
// la etiqueta de su tipo y el campo ID_aliado = codigo_aliado. Nunca se envía aliados.id (§2).

import { ErrorClientify } from './cliente.js';
import { CAMPO_ID_ALIADO, ETIQUETA_ALIADO, ETIQUETAS_TIPO, ETIQUETA_PRUEBA, MARCA_CORREO_PRUEBA } from './mapeo.js';

/** Todo lo que no sea el entorno Production de Vercel escribe en Clientify como prueba (§10). */
export function esEntornoDePruebas(entorno) {
  return entorno !== 'production';
}

/** Divide el nombre completo en nombre y apellidos para Clientify (la unión conserva el nombre original). */
export function separarNombre(nombreCompleto) {
  const partes = String(nombreCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return { first_name: partes[0] || '', last_name: '' };
  if (partes.length === 2) return { first_name: partes[0], last_name: partes[1] };
  if (partes.length === 3) return { first_name: partes[0], last_name: partes.slice(1).join(' ') };
  return { first_name: partes.slice(0, 2).join(' '), last_name: partes.slice(2).join(' ') };
}

export function etiquetasDelAliado(aliado, entorno) {
  const etiquetaTipo = ETIQUETAS_TIPO[aliado.tipo_aliado];
  if (!etiquetaTipo) throw new ErrorClientify(`Tipo de aliado sin etiqueta en Clientify: ${aliado.tipo_aliado}`, { reintentable: false });
  return [ETIQUETA_ALIADO, etiquetaTipo, ...(esEntornoDePruebas(entorno) ? [ETIQUETA_PRUEBA] : [])];
}

/** Datos del contacto en Clientify a partir de la fila reclamada (función pura). */
export function construirContacto(aliado, entorno) {
  return {
    ...separarNombre(aliado.nombre_completo),
    email: aliado.correo,
    phone: aliado.celular,
    ...(aliado.cargo ? { title: aliado.cargo } : {}),
    tags: etiquetasDelAliado(aliado, entorno),
    custom_fields: [{ field: CAMPO_ID_ALIADO, value: aliado.codigo_aliado }]
  };
}

/** Fuera de Production solo se sincronizan correos de prueba, para no tocar contactos reales (§10). */
export function validarEntorno(aliado, entorno) {
  if (esEntornoDePruebas(entorno) && !String(aliado.correo || '').toLowerCase().includes(MARCA_CORREO_PRUEBA)) {
    throw new ErrorClientify(`Entorno de pruebas (${entorno}): solo se sincronizan correos que contengan "${MARCA_CORREO_PRUEBA}"`, { reintentable: false });
  }
}

async function agregarEtiquetas(clientify, id, etiquetas) {
  for (const etiqueta of etiquetas) {
    try {
      await clientify.agregarEtiqueta(id, etiqueta);
    } catch (e) {
      // Una etiqueta que el contacto ya tiene puede responder 4xx; no invalida la sincronización.
      if (!(e instanceof ErrorClientify) || e.reintentable) throw e;
    }
  }
}

/**
 * Crea o actualiza el contacto del aliado en Clientify y devuelve { contactId, accion }.
 *   - Sin clientify_contact_id: si ya existe un contacto con ese correo (p. ej. un cliente que se vuelve
 *     Cliente Embajador) se vincula sin pisar sus datos: solo se agregan ID_aliado y las etiquetas.
 *     Si no existe, se crea.
 *   - Con clientify_contact_id (edición del perfil): se actualizan nombre, celular, cargo, etiquetas e ID_aliado.
 *     Si el contacto ya no existe en Clientify (404), se vuelve a buscar o crear.
 */
export async function sincronizarAliado(aliado, { clientify, entorno }) {
  validarEntorno(aliado, entorno);
  const { tags, ...datos } = construirContacto(aliado, entorno);

  if (aliado.clientify_contact_id) {
    try {
      await clientify.actualizarContacto(aliado.clientify_contact_id, datos);
      await agregarEtiquetas(clientify, aliado.clientify_contact_id, tags);
      return { contactId: String(aliado.clientify_contact_id), accion: 'actualizado' };
    } catch (e) {
      if (!(e instanceof ErrorClientify) || e.status !== 404) throw e;
    }
  }

  const existente = await clientify.buscarContactoPorCorreo(aliado.correo);
  if (existente && existente.id != null) {
    const id = String(existente.id);
    await clientify.actualizarContacto(id, { custom_fields: datos.custom_fields });
    await agregarEtiquetas(clientify, id, tags);
    return { contactId: id, accion: 'vinculado' };
  }

  const creado = await clientify.crearContacto({ ...datos, tags });
  if (!creado || creado.id == null) throw new ErrorClientify('Clientify no devolvió el ID del contacto creado');
  return { contactId: String(creado.id), accion: 'creado' };
}
