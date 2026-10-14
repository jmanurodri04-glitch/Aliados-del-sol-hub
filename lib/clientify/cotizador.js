// Cotizador Solar → Clientify («Solicitar propuesta», CLAUDE.md §7.5). Mapeo definido por el equipo (oct 2026):
//   - Contacto con la etiqueta «Cotizador Hub» (y «PRUEBA HUB» fuera de Production). Sin ID_aliado, sin las
//     etiquetas de referidos y sin oportunidad: no dispara los flujos de WhatsApp ni de n8n de los referidos.
//   - Residencial: nombre, teléfono, correo y ciudad (los principales del contacto). Comercial e industrial: además
//     la empresa (`company`), el contacto como nombre y el «Subsector Economico».
//   - Sector (`contact_sector`) = Residencial, Comercial o Industrial. Origen (`contact_source`) = «Cotizador Aliados
//     del sol». Tipo (`contact_type`) = «Prospecto Off Grid» si no está conectado a la red; si no, «Prospecto
//     Autoconsumo ON GRID».
//   - Campos personalizados: consumo, valor de la factura, ahorro anual, potencia, número de paneles, payback, área
//     mínima e inversión total. «Importe» es de la oportunidad (no existe en el contacto, confirmado con la
//     exportación de contactos), así que la inversión va en «Posibilidad de negocio ($)». La generación al mes, la
//     cobertura y el CO₂ no van.
//   - Si el correo ya es de un contacto de Clientify, se le agregan los campos, la etiqueta y el resumen en la
//     descripción, y se llenan los datos que tenga vacíos. El Tipo, el origen y el sector pasan a los del cotizador,
//     salvo en el contacto de un aliado o de un referido (ver actualizacionDeExistente).
// Los nombres de los campos están confirmados con la exportación de contactos de Clientify (oct 2026); si Clientify rechaza alguno (400), el contacto se crea sin
// los campos y los valores quedan en la descripción, que siempre los lleva.
// En logs y respuestas nunca van correos, nombres ni teléfonos.

import { normalizarTexto } from './avance.js';
import { ErrorClientify } from './cliente.js';
import { esEntornoDePruebas, separarNombre } from './aliados.js';
import {
  CAMPO_SUBSECTOR_CONTACTO, CAMPO_TIPO_CONTACTO, CAMPO_VALOR_FACTURA_CONTACTO, ETIQUETA_PRUEBA, MARCA_CORREO_PRUEBA, PAIS_CLIENTIFY,
  TIPO_CONTACTO_ALIADO, leerContacto
} from './mapeo.js';

export const ETIQUETA_COTIZADOR = 'Cotizador Hub';
export const ORIGEN_COTIZADOR = 'Cotizador Aliados del sol';
export const CAMPO_ORIGEN_CONTACTO = 'contact_source';
export const TIPO_OFF_GRID = 'Prospecto Off Grid';
export const TIPO_ON_GRID = 'Prospecto Autoconsumo ON GRID';
export const CAMPOS_COTIZADOR = {
  consumo: 'Consumo (kWp/mes)',
  valorFactura: CAMPO_VALOR_FACTURA_CONTACTO,
  ahorroAnual: 'Ahorro generado anual',
  potencia: 'Potencia',
  paneles: '# Paneles aprox',
  payback: 'Payback',
  areaMinima: 'Área mínima requerida',
  inversion: 'Posibilidad de negocio ($)'
};
const SECTORES = { residencial: 'Residencial', comercial: 'Comercial', industrial: 'Industrial' };
const ALMACENAMIENTO = { none: 'Sin baterías', respaldo: 'Respaldo', autonomia: 'Autonomía nocturna', extendida: 'Autonomía extendida' };

const entero = (v) => (v == null ? null : String(Math.round(Number(v))));
const decimal = (v, d = 1) => (v == null ? null : String(Math.round(Number(v) * 10 ** d) / 10 ** d));
const miles = (v) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(Number(v));

export function tipoDeContacto(c) {
  return c.conectado_red ? TIPO_ON_GRID : TIPO_OFF_GRID;
}

export function etiquetasDeCotizacion(entorno) {
  return [ETIQUETA_COTIZADOR, ...(esEntornoDePruebas(entorno) ? [ETIQUETA_PRUEBA] : [])];
}

/** Campos personalizados (sin los que no aplican: un sistema aislado no tiene ahorro ni payback). */
export function camposDeCotizacion(c) {
  const lista = [
    [CAMPOS_COTIZADOR.consumo, entero(c.consumo_kwh_mes)],
    [CAMPOS_COTIZADOR.valorFactura, entero(c.valor_factura_cop)],
    [CAMPOS_COTIZADOR.ahorroAnual, entero(c.ahorro_anual_cop)],
    [CAMPOS_COTIZADOR.potencia, decimal(c.potencia_kwp, 2)],
    [CAMPOS_COTIZADOR.paneles, entero(c.modulos)],
    // «Payback» es un campo entero en Clientify (descarta un decimal sin avisar): años redondeados; la descripción lleva el decimal.
    [CAMPOS_COTIZADOR.payback, entero(c.payback_anios)],
    [CAMPOS_COTIZADOR.areaMinima, entero(c.area_minima_m2)],
    [CAMPOS_COTIZADOR.inversion, entero(c.inversion_total_cop)],
    ...(c.segmento !== 'residencial' && c.subsector ? [[CAMPO_SUBSECTOR_CONTACTO, c.subsector]] : [])
  ];
  return lista.filter(([, v]) => v != null).map(([field, value]) => ({ field, value }));
}

/** Resumen legible del diseño (va siempre en la descripción, por si un campo no existe en Clientify). */
export function resumenCotizacion(c) {
  const fecha = new Date(c.created_at || Date.now()).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
  return [
    `Cotizador Solar (${fecha}) · Proyecto ${SECTORES[c.segmento] || c.segmento}` + (c.segmento !== 'residencial' && c.subsector ? ` · ${c.subsector}` : ''),
    `${c.conectado_red ? 'Conectado a la red' : 'No conectado a la red (aislado)'} · ${ALMACENAMIENTO[c.almacenamiento] || c.almacenamiento}` +
      (Number(c.almacenamiento_kwh) > 0 ? ` (${miles(c.almacenamiento_kwh)} kWh)` : ''),
    `Consumo: ${miles(c.consumo_kwh_mes)} kWh/mes · Factura: $${miles(Math.round(c.valor_factura_cop))}/mes`,
    `Potencia: ${miles(c.potencia_kwp)} kWp · ${miles(c.modulos)} paneles de 615 Wp · Área mínima: ${miles(Math.round(c.area_minima_m2))} m²`,
    (c.ahorro_anual_cop != null ? `Ahorro anual: $${miles(Math.round(c.ahorro_anual_cop))} · Payback: ${miles(c.payback_anios)} años · ` : '') +
      `Inversión total: $${miles(Math.round(c.inversion_total_cop))} + IVA`,
    'Valores aproximados del cotizador; el equipo GEENERA los valida con la factura real.'
  ].join('\n');
}

/** Contacto nuevo en Clientify a partir de la fila reclamada (función pura). */
export function construirContactoCotizacion(c, entorno) {
  const empresa = c.segmento !== 'residencial';
  return {
    ...separarNombre(empresa ? c.contacto : c.nombre),
    email: c.correo,
    phone: c.telefono,
    ...(empresa ? { company: c.empresa } : {}),
    contact_sector: SECTORES[c.segmento],
    [CAMPO_ORIGEN_CONTACTO]: ORIGEN_COTIZADOR,
    [CAMPO_TIPO_CONTACTO]: tipoDeContacto(c),
    addresses: [{ city: c.ciudad, country: PAIS_CLIENTIFY }],
    description: resumenCotizacion(c),
    tags: etiquetasDeCotizacion(entorno),
    custom_fields: camposDeCotizacion(c)
  };
}

/** Fuera de Production solo van a Clientify los correos de prueba (§10). */
export function validarEntornoCotizacion(c, entorno) {
  if (esEntornoDePruebas(entorno) && !String(c.correo || '').toLowerCase().includes(MARCA_CORREO_PRUEBA)) {
    throw new ErrorClientify(`Entorno de pruebas (${entorno}): solo se envían a Clientify correos que contengan "${MARCA_CORREO_PRUEBA}"`, { reintentable: false });
  }
}

const esRechazo = (e) => e instanceof ErrorClientify && e.status === 400;
const vacio = (v) => v == null || (typeof v === 'string' && !v.trim());
const nombreDeValor = (v) => (v && typeof v === 'object' ? v.name ?? v.label ?? v.value ?? null : v);

/**
 * Datos para un contacto que ya existe en Clientify (función pura). Siempre van los campos del cotizador y el
 * resumen al final de la descripción (sin repetirlo). El nombre, el teléfono, la empresa y la ciudad solo se llenan
 * si están vacíos. El Tipo, el origen y el sector se actualizan, salvo en el contacto de un aliado o de un referido
 * (tiene ID_aliado o el Tipo «Aliados Estratégicos»), donde cambiarlos rompería sus flujos: ahí solo se llenan si
 * están vacíos.
 */
export function actualizacionDeExistente(actual, datos) {
  const leido = leerContacto(actual || {});
  const tipoActual = nombreDeValor(actual && actual[CAMPO_TIPO_CONTACTO]);
  const protegido = Boolean(leido.idAliado) || normalizarTexto(tipoActual || '') === normalizarTexto(TIPO_CONTACTO_ALIADO);
  const cambios = { custom_fields: datos.custom_fields };

  const descripcion = String((actual && actual.description) || '');
  if (!descripcion.includes(datos.description)) cambios.description = descripcion.trim() ? descripcion.trimEnd() + '\n\n' + datos.description : datos.description;
  if (!leido.nombre) Object.assign(cambios, { first_name: datos.first_name, last_name: datos.last_name });
  if (!leido.telefono && datos.phone) cambios.phone = datos.phone;
  if (datos.company && !leido.empresa) cambios.company = datos.company;
  if (!leido.ciudad) cambios.addresses = datos.addresses;
  for (const campo of [CAMPO_TIPO_CONTACTO, CAMPO_ORIGEN_CONTACTO, 'contact_sector']) {
    if (!protegido || vacio(nombreDeValor(actual && actual[campo]))) cambios[campo] = datos[campo];
  }
  return { cambios, protegido };
}

/** Actualiza un contacto existente; si Clientify rechaza algo opcional (400), reintenta sin eso. */
async function actualizarExistente(id, datos, tags, clientify) {
  const actual = await clientify.obtenerContacto(id);
  const { cambios, protegido } = actualizacionDeExistente(actual, datos);
  const sin = (obj, claves) => Object.fromEntries(Object.entries(obj).filter(([k]) => !claves.includes(k)));
  const intentos = [
    cambios,
    sin(cambios, ['addresses', 'contact_sector', 'phone', 'company']),
    sin(cambios, ['addresses', 'contact_sector', 'phone', 'company', 'custom_fields'])
  ];
  let completo = false;
  for (const [i, cuerpo] of intentos.entries()) {
    try { await clientify.actualizarContacto(id, cuerpo); completo = i === 0; break; } catch (e) {
      if (!esRechazo(e)) throw e;
      if (i === intentos.length - 1) throw e;
    }
  }
  for (const etiqueta of tags) {
    try { await clientify.agregarEtiqueta(id, etiqueta); } catch (e) {
      if (!(e instanceof ErrorClientify) || e.reintentable) throw e; // una etiqueta repetida (4xx) no es un error
    }
  }
  return { contactId: id, accion: (protegido ? 'actualizado_contacto_programa' : 'actualizado') + (completo ? '' : '_parcial') };
}

/** Envía la propuesta a Clientify y devuelve { contactId, accion }. */
export async function enviarCotizacion(c, { clientify, entorno }) {
  validarEntornoCotizacion(c, entorno);
  const { tags, ...datos } = construirContactoCotizacion(c, entorno);

  const existente = c.clientify_contact_id ? { id: c.clientify_contact_id } : await clientify.buscarContactoPorCorreo(c.correo);
  if (existente && existente.id != null) return actualizarExistente(String(existente.id), datos, tags, clientify);

  // Contacto nuevo. Si Clientify rechaza algo opcional (400), se reintenta sin eso; los valores siguen en la descripción.
  const intentos = [
    { ...datos, tags },
    (({ addresses, contact_sector, ...resto }) => ({ ...resto, tags }))(datos),
    (({ addresses, contact_sector, custom_fields, ...resto }) => ({ ...resto, tags }))(datos)
  ];
  let ultimo;
  for (const cuerpo of intentos) {
    try {
      const creado = await clientify.crearContacto(cuerpo);
      if (!creado || creado.id == null) throw new ErrorClientify('Clientify no devolvió el ID del contacto creado');
      return { contactId: String(creado.id), accion: cuerpo.custom_fields ? 'creado' : 'creado_sin_campos' };
    } catch (e) {
      if (!esRechazo(e)) throw e;
      ultimo = e;
    }
  }
  throw ultimo;
}

const detalleDe = (error) => [error.code, error.message].filter(Boolean).join(': ').slice(0, 200);

/**
 * Procesa la cola de propuestas del cotizador. Con `segmento` e `id` procesa solo esa (envío inmediato desde
 * /api/cotizador). Devuelve un resumen sin datos personales.
 */
export async function procesarCotizaciones({ supabase, clientify, entorno, limite = 5, segmento = null, id = null, seguir = () => true }) {
  const resumen = { procesados: 0, ok: 0, errores: 0, pospuestos: 0, detalle: [] };
  const { data: lote, error } = await supabase.rpc('cotizador_reclamar_propuestas', { p_limite: limite, p_segmento: segmento, p_id: id });
  if (error) throw new Error('No se pudo leer la cola del cotizador (' + detalleDe(error) + ')');

  for (const c of lote || []) {
    if (!seguir()) { resumen.pospuestos++; continue; }
    resumen.procesados++;
    try {
      const { contactId, accion } = await enviarCotizacion(c, { clientify, entorno });
      const { error: e } = await supabase.rpc('cotizador_resultado_propuesta', { p_segmento: c.segmento, p_id: c.id, p_contact_id: contactId, p_error: null });
      if (e) throw new Error('Enviado a Clientify pero no se pudo registrar el resultado');
      resumen.ok++;
      resumen.detalle.push({ segmento: c.segmento, accion });
    } catch (e) {
      const motivo = (e && e.message) || 'Error desconocido';
      await supabase.rpc('cotizador_resultado_propuesta', { p_segmento: c.segmento, p_id: c.id, p_contact_id: null, p_error: motivo });
      resumen.errores++;
      resumen.detalle.push({ segmento: c.segmento, error: motivo });
    }
  }
  return resumen;
}
