// Derivación del avance (CLAUDE.md §8, tablas A, B y C): datos de Clientify → variables de avance_empresa.
// Función pura: no llama a nada. Los nombres de Clientify vienen de mapeo.js.
//
// `actual` son los valores vigentes en el Hub. Las variables derivadas (fuera_perfil, integridad,
// evaluación técnica 'no') usan el valor efectivo: el definitivo del Hub si ya existe (§5.1), si no el de Clientify.

import {
  ESTADOS_CONTACTO, ETIQUETA_INFORMACION_FALSA, ETIQUETA_REFERIDO_IMPERFECTO, ETIQUETA_REFERIDO_PERFECTO,
  FASE_EVALUACION_TECNICA, FASE_NEGOCIO_CERRADO, FASE_PROPUESTA_COMERCIAL, FASES_OPORTUNIDAD
} from './mapeo.js';

/** Minúsculas, sin tildes, espacios simples. */
export function normalizarTexto(v) {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "6. Presentación de oferta" → 6. Sin prefijo numérico → null. */
export function numeroDeFase(fase) {
  const m = String(fase ?? '').match(/^\s*(\d{1,3})\s*[.)\-:]/);
  return m ? Number(m[1]) : null;
}

/** Con varias oportunidades se usa la más avanzada (mayor número de fase) (§8). */
export function elegirOportunidad(oportunidades) {
  let mejor = null;
  for (const o of oportunidades || []) {
    const n = numeroDeFase(o.fase) ?? -1;
    if (!mejor || n > (numeroDeFase(mejor.fase) ?? -1)) mejor = o;
  }
  return mejor;
}

// También se reconoce el Status sin el número del prefijo ("lead caliente").
const sinPrefijo = (t) => t.replace(/^\d+\s*[.)\-:]\s*/, '');
const ESTADOS_SIN_PREFIJO = Object.fromEntries(Object.entries(ESTADOS_CONTACTO).map(([k, v]) => [sinPrefijo(k), v]));
function reglaDeEstado(status) {
  const t = normalizarTexto(status);
  return ESTADOS_CONTACTO[t] ?? ESTADOS_SIN_PREFIJO[sinPrefijo(t)];
}

const definitivo = (v) => v === 'si' || v === 'no';
const tieneEtiqueta = (etiquetas, nombre) =>
  !!nombre && (etiquetas || []).some((e) => normalizarTexto(e) === normalizarTexto(nombre));

/**
 * @param {{ contacto: object, oportunidad?: object|null }} datos  salida de leerContacto / leerOportunidad
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

  // B. Fase de la oportunidad → avance comercial (se usa "mayor o igual").
  let fase = null;
  if (oportunidad && oportunidad.fase != null) {
    fase = numeroDeFase(oportunidad.fase);
    if (fase == null || !(fase in FASES_OPORTUNIDAD)) {
      avisos.push(`Fase de oportunidad desconocida: "${String(oportunidad.fase).slice(0, 80)}"`);
      fase = null;
    }
  }
  const perdida = oportunidad && oportunidad.estado === 'perdida';
  const oportunidadTecnica = fase != null && fase >= FASE_EVALUACION_TECNICA ? 'si'
    : calificadoEf === 'no' || (perdida && (fase ?? 0) < FASE_EVALUACION_TECNICA) ? 'no' : 'revision';
  const propuesta = fase != null && fase >= FASE_PROPUESTA_COMERCIAL ? 'si' : 'revision';
  const cierre = fase != null && fase >= FASE_NEGOCIO_CERRADO ? 'si' : 'revision';

  // C. Derivadas.
  const integridad = definitivo(calificadoEf) ? calificadoEf : 'revision';
  const fueraPerfil = calificadoEf === 'si' ? 'no'
    : calificadoEf === 'no' ? (perfectoEf === 'si' ? 'si' : perfectoEf === 'no' ? 'no' : 'revision')
    : 'revision';
  const informacionFalsa = tieneEtiqueta(contacto.etiquetas, ETIQUETA_INFORMACION_FALSA) ? 'si' : 'revision';

  const crudos = {
    estado_contacto_clientify: contacto.status ?? null,
    lead_scoring: contacto.leadScoring ?? null,
    fase_oportunidad: oportunidad ? oportunidad.fase ?? null : null,
    fase_oportunidad_num: oportunidad ? numeroDeFase(oportunidad.fase) : null,
    estado_oportunidad: oportunidad ? oportunidad.estado ?? null : null,
    valor_oportunidad: oportunidad ? oportunidad.valor ?? null : null
  };
  // Mientras los campos no estén confirmados (mapeo.js), no se tocan los valores guardados.
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
