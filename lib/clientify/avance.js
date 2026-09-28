// Derivación del avance (CLAUDE.md §8, tablas A, B y C): datos de Clientify → variables de avance_empresa.
// Función pura: no llama a nada. Los nombres de Clientify vienen de mapeo.js.
//
// `actual` son los valores vigentes en el Hub. Las variables derivadas (fuera_perfil, integridad,
// evaluación técnica 'no') usan el valor efectivo: el definitivo del Hub si ya existe (§5.1), si no el de Clientify.

import {
  ESTADOS_CONTACTO, ETIQUETAS_INFORMACION_FALSA, ETIQUETA_REFERIDO_IMPERFECTO, ETIQUETA_REFERIDO_PERFECTO, HITOS_FASE,
  idDeUrl
} from './mapeo.js';

const HITOS = ['oportunidad_tecnica', 'propuesta_comercial', 'negocio_cerrado'];

/** Minúsculas, sin tildes, espacios simples. */
export function normalizarTexto(v) {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "6. Presentación de oferta" → 6. Sin prefijo numérico → null. */
export function numeroDeFase(fase) {
  const m = String(fase ?? '').match(/^\s*(\d{1,3})\s*[.)\-:]/);
  return m ? Number(m[1]) : null;
}

// También se reconocen el Status y las fases sin el número del prefijo ("lead caliente", "Diseño").
const sinPrefijo = (t) => t.replace(/^\d+\s*[.)\-:]\s*/, '');

/**
 * Catálogo de fases de todos los embudos (API /deals/pipelines/stages/) →
 *   fases: id de fase → { embudo, posicion }
 *   hitos: embudo → { oportunidad_tecnica, propuesta_comercial, negocio_cerrado } = posición de la fase del hito
 */
export function construirCatalogoFases(lista) {
  const fases = new Map();
  const hitos = new Map();
  for (const f of lista || []) {
    const embudo = idDeUrl(f.pipeline, 'pipelines') ?? String(f.pipeline_desc ?? '');
    const posicion = Number(f.position);
    fases.set(String(f.id), { embudo, posicion });
    const nombre = sinPrefijo(normalizarTexto(f.name));
    for (const [variable, nombres] of Object.entries(HITOS_FASE)) {
      if (!nombres.includes(nombre)) continue;
      const h = hitos.get(embudo) || {};
      if (h[variable] == null || posicion < h[variable]) h[variable] = posicion;
      hitos.set(embudo, h);
    }
  }
  return { fases, hitos };
}

/**
 * Hitos que alcanzó una oportunidad: su fase está en la posición del hito o después ("mayor o igual").
 * null si la fase no está en el catálogo (desconocida).
 */
export function hitosDeOportunidad(oportunidad, catalogo) {
  const fase = oportunidad && oportunidad.faseId && catalogo ? catalogo.fases.get(String(oportunidad.faseId)) : null;
  if (!fase) return null;
  const posiciones = catalogo.hitos.get(fase.embudo) || {};
  const r = { posicion: fase.posicion, nivel: 0 };
  for (const h of HITOS) {
    r[h] = posiciones[h] != null && fase.posicion >= posiciones[h];
    if (r[h]) r.nivel++;
  }
  return r;
}

/** Con varias oportunidades se usa la más avanzada (§8): más hitos alcanzados y, a igualdad, fase posterior. */
export function elegirOportunidad(oportunidades) {
  const clave = (o) => [o.hitos ? o.hitos.nivel : -1, o.hitos ? o.hitos.posicion : -1];
  let mejor = null;
  for (const o of oportunidades || []) {
    if (!mejor) { mejor = o; continue; }
    const [a, b] = [clave(o), clave(mejor)];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) mejor = o;
  }
  return mejor;
}

const ESTADOS_SIN_PREFIJO = Object.fromEntries(Object.entries(ESTADOS_CONTACTO).map(([k, v]) => [sinPrefijo(k), v]));
function reglaDeEstado(status) {
  const t = normalizarTexto(status);
  return ESTADOS_CONTACTO[t] ?? ESTADOS_SIN_PREFIJO[sinPrefijo(t)];
}

const definitivo = (v) => v === 'si' || v === 'no';
const tieneEtiqueta = (etiquetas, nombre) =>
  !!nombre && (etiquetas || []).some((e) => normalizarTexto(e) === normalizarTexto(nombre));

/**
 * @param {{ contacto: object, oportunidad?: object|null }} datos  salida de leerContacto / leerOportunidad;
 *        la oportunidad lleva `hitos` (hitosDeOportunidad), o null si su fase es desconocida
 * @param {{ calificado?: string, perfecto?: string }} actual     valores vigentes en el Hub
 * @returns {{ variables: object, crudos: object, avisos: string[] }}
 */
export function derivarAvance({ contacto, oportunidad = null }, actual = {}) {
  const avisos = [];

  // A. Status del contacto → calificado.
  let calificado = 'revision';
  if (contacto.status != null && String(contacto.status).trim() !== '') {
    const regla = reglaDeEstado(contacto.status);
    if (regla === undefined) avisos.push(`Status de contacto desconocido: "${String(contacto.status).slice(0, 80)}"`);
    else if (regla !== 'sin_cambio') calificado = regla;
  }
  const calificadoEf = definitivo(actual.calificado) ? actual.calificado : calificado;

  // C. Perfecto por etiqueta.
  const perfecto = tieneEtiqueta(contacto.etiquetas, ETIQUETA_REFERIDO_PERFECTO) ? 'si'
    : tieneEtiqueta(contacto.etiquetas, ETIQUETA_REFERIDO_IMPERFECTO) ? 'no' : 'revision';
  const perfectoEf = definitivo(actual.perfecto) ? actual.perfecto : perfecto;

  // B. Fase de la oportunidad → hitos del avance comercial (por nombre y posición de la fase en su embudo).
  const hitos = oportunidad ? oportunidad.hitos || null : null;
  if (oportunidad && !hitos) avisos.push(`Fase de oportunidad desconocida: "${String(oportunidad.fase ?? '?').slice(0, 80)}"`);
  const perdida = oportunidad && oportunidad.estado === 'perdida';
  const oportunidadTecnica = hitos && hitos.oportunidad_tecnica ? 'si'
    : calificadoEf === 'no' || (perdida && hitos && !hitos.oportunidad_tecnica) ? 'no' : 'revision';
  const propuesta = hitos && hitos.propuesta_comercial ? 'si' : 'revision';
  const cierre = hitos && hitos.negocio_cerrado ? 'si' : 'revision';

  // C. Derivadas.
  const integridad = definitivo(calificadoEf) ? calificadoEf : 'revision';
  const fueraPerfil = calificadoEf === 'si' ? 'no'
    : calificadoEf === 'no' ? (perfectoEf === 'si' ? 'si' : perfectoEf === 'no' ? 'no' : 'revision')
    : 'revision';
  const informacionFalsa = ETIQUETAS_INFORMACION_FALSA.some((e) => tieneEtiqueta(contacto.etiquetas, e)) ? 'si' : 'revision';

  const crudos = {
    estado_contacto_clientify: contacto.status ?? null,
    fase_oportunidad: oportunidad ? oportunidad.fase ?? null : null,
    fase_oportunidad_num: oportunidad ? numeroDeFase(oportunidad.fase) : null,
    estado_oportunidad: oportunidad ? oportunidad.estado ?? null : null,
    valor_oportunidad: oportunidad ? oportunidad.valor ?? null : null
  };
  // Lo que no viene en la API no borra lo guardado (el lead scoring no está en la API de contactos).
  if (contacto.leadScoring != null) crudos.lead_scoring = contacto.leadScoring;
  if (oportunidad && oportunidad.valorCotizado != null) crudos.valor_cotizado = oportunidad.valorCotizado;
  if (oportunidad && oportunidad.potenciaKwp != null) crudos.potencia_instalada_kwp = oportunidad.potenciaKwp;

  return {
    variables: {
      calificado,
      perfecto,
      fuera_perfil: fueraPerfil,
      oportunidad_tecnica: oportunidadTecnica,
      propuesta_comercial: propuesta,
      negocio_cerrado: cierre,
      informacion_falsa: informacionFalsa,
      integridad_informacion: integridad
    },
    crudos,
    avisos
  };
}
