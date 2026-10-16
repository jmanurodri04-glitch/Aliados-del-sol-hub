// Preguntas MEDDPICC del Cotizador Solar (decisión del equipo, 16 oct 2026; CLAUDE.md §7.5).
//
// Bloquean solo «Descargar precotización (PDF)»: el aliado las responde una vez por cotización y se guardan con ella
// (columna meddpicc). Son 7, todas obligatorias, y cada una tiene «Aún no lo sé» para responder rápido. «Otro/Otra»
// abre un texto corto opcional. Lo usan el navegador (ventana del cotizador), el servidor (/api/cotizador valida
// antes de guardar), Clientify (resumen en la descripción) y el panel (CSV). Funciones puras.
//
// Los id de las preguntas y de las opciones se guardan en la base: no se cambian. Para cambiar un texto basta con
// editarlo aquí; para quitar una opción, se deja de mostrar pero se conserva su id para leer lo ya guardado.

export const VERSION_MEDDPICC = 1;
export const MAX_OTRO = 100;
const NO_SE = { id: 'no_se', t: 'Aún no lo sé' };

/** tRes: texto en residencial (si cambia). varias: casillas con un máximo; si no, una sola opción. */
export const PREGUNTAS = [
  {
    id: 'necesidad', letra: 'I', tema: 'Dolor',
    t: '¿Por qué quiere el cliente un sistema solar ahora?',
    opciones: [
      { id: 'factura', t: 'Bajar la factura de energía' },
      { id: 'tarifa', t: 'Protegerse de las subidas de tarifa' },
      { id: 'ambiental', t: 'Cumplir una meta ambiental' },
      { id: 'ampliacion', t: 'Más consumo o una ampliación' },
      { id: 'respaldo', t: 'Respaldo ante cortes de energía' },
      { id: 'requisito', t: 'Un requisito o compromiso (cliente, licitación, norma)' },
      { id: 'explorando', t: 'Solo está explorando' },
      { id: 'otra', t: 'Otra', otro: true },
      { id: 'no_se', t: 'Aún no lo sé' }
    ]
  },
  {
    id: 'resultado', letra: 'M', tema: 'Métricas',
    t: '¿Qué resultado espera conseguir?',
    opciones: [
      { id: 'ahorro', t: 'Ahorrar dinero cada mes' },
      { id: 'cobertura', t: 'Cubrir la mayor parte del consumo con sol' },
      { id: 'retorno', t: 'Recuperar la inversión en pocos años' },
      { id: 'emisiones', t: 'Reducir emisiones' },
      { id: 'otro', t: 'Otro', otro: true },
      { id: 'no_se', t: 'Aún no lo ha definido' }
    ]
  },
  {
    id: 'criterios', letra: 'D', tema: 'Criterios de decisión', varias: 3,
    t: '¿Qué es lo que más pesa al elegir propuesta?',
    opciones: [
      { id: 'precio', t: 'Precio' },
      { id: 'ahorro', t: 'Ahorro y retorno de la inversión' },
      { id: 'financiacion', t: 'Financiación y forma de pago' },
      { id: 'equipos', t: 'Calidad de equipos y garantías' },
      { id: 'confianza', t: 'Confianza en el proveedor' },
      { id: 'tiempo', t: 'Tiempo de instalación' },
      { id: 'tramites', t: 'Trámites incluidos' },
      { id: 'posventa', t: 'Mantenimiento y posventa' },
      { id: 'otro', t: 'Otro', otro: true },
      { id: 'no_se', t: 'Aún no lo sé', unica: true }
    ]
  },
  {
    id: 'autoridad', letra: 'E', tema: 'Autoridad económica',
    t: '¿Quién da el sí final a la inversión?',
    opciones: [
      { id: 'dueno', t: 'El dueño o los socios', tRes: 'El propietario o la familia' },
      { id: 'gerencia', t: 'Gerencia general', soloEmpresa: true },
      { id: 'financiera', t: 'Área financiera', soloEmpresa: true },
      { id: 'comite', t: 'Junta o comité', soloEmpresa: true },
      { id: 'contacto', t: 'La misma persona con quien hablo' },
      { id: 'otra', t: 'Otra', otro: true },
      NO_SE
    ]
  },
  {
    id: 'pendientes', letra: 'D', tema: 'Proceso de decisión', varias: 3,
    t: '¿Qué falta para que decida?',
    opciones: [
      { id: 'visita', t: 'Visita técnica' },
      { id: 'cotizaciones', t: 'Recibir otras cotizaciones' },
      { id: 'comparar', t: 'Comparar propuestas' },
      { id: 'numeros', t: 'Validar el ahorro y los números' },
      { id: 'presupuesto', t: 'Conseguir presupuesto o financiación' },
      { id: 'aprobacion', t: 'Presentarlo a gerencia, socios o comité', tRes: 'Presentarlo a la familia' },
      { id: 'elegido', t: 'Nada, ya eligió proveedor', unica: true },
      { id: 'no_se', t: 'Aún no lo sé', unica: true }
    ]
  },
  {
    id: 'cuando', letra: 'D', tema: 'Tiempos',
    t: '¿Para cuándo piensa decidir?',
    opciones: [
      { id: 'mes', t: 'Este mes' },
      { id: '1_3', t: 'En 1 a 3 meses' },
      { id: '3_6', t: 'En 3 a 6 meses' },
      { id: 'mas_6', t: 'En más de 6 meses' },
      { id: 'sin_fecha', t: 'No tiene fecha' },
      NO_SE
    ]
  },
  {
    id: 'competencia', letra: 'C', tema: 'Competencia',
    t: '¿Con quién más lo está comparando?',
    opciones: [
      { id: 'solo_geenera', t: 'Solo con nosotros' },
      { id: '1_2', t: 'Con 1 o 2 proveedores más' },
      { id: '3_mas', t: 'Con 3 o más' },
      { id: 'nada', t: 'Está pensando en no hacer nada por ahora' },
      NO_SE
    ]
  }
];

const residencial = (segmento) => segmento === 'residencial';

/** Preguntas con los textos y opciones del tipo de proyecto (residencial cambia algunos textos y quita opciones). */
export function preguntasPara(segmento) {
  const res = residencial(segmento);
  return PREGUNTAS.map((p) => ({
    id: p.id, letra: p.letra, tema: p.tema, t: p.t, varias: p.varias || 0,
    opciones: p.opciones.filter((o) => !(res && o.soloEmpresa)).map((o) => ({ id: o.id, t: res && o.tRes ? o.tRes : o.t, otro: !!o.otro, unica: !!o.unica }))
  }));
}

/**
 * Valida las respuestas y devuelve { ok: true, valor } con la forma que se guarda
 * ({ v, respuestas: { [pregunta]: { o: [ids], otro? } } }) o { ok: false, pregunta, error }.
 * Entrada: { [pregunta]: { o: id | [ids], otro?: texto } }.
 */
export function validarMeddpicc(entrada, segmento) {
  const e = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};
  const respuestas = {};
  for (const p of preguntasPara(segmento)) {
    const r = e[p.id] && typeof e[p.id] === 'object' ? e[p.id] : {};
    const elegidas = [...new Set((Array.isArray(r.o) ? r.o : r.o == null ? [] : [r.o]).map(String))];
    const ids = new Set(p.opciones.map((o) => o.id));
    if (!elegidas.length) return { ok: false, pregunta: p.id, error: 'Responde: ' + p.t };
    if (elegidas.some((id) => !ids.has(id))) return { ok: false, pregunta: p.id, error: 'Revisa la respuesta de: ' + p.t };
    if (!p.varias && elegidas.length > 1) return { ok: false, pregunta: p.id, error: 'Elige una sola opción en: ' + p.t };
    if (p.varias && elegidas.length > p.varias) return { ok: false, pregunta: p.id, error: 'Elige máximo ' + p.varias + ' opciones en: ' + p.t };
    const unica = p.opciones.find((o) => o.unica && elegidas.includes(o.id));
    if (unica && elegidas.length > 1) return { ok: false, pregunta: p.id, error: '«' + unica.t + '» no se combina con otras opciones.' };
    const conOtro = p.opciones.find((o) => o.otro && elegidas.includes(o.id));
    const otro = conOtro && typeof r.otro === 'string' ? r.otro.trim().replace(/\s+/g, ' ').slice(0, MAX_OTRO) : '';
    respuestas[p.id] = otro ? { o: elegidas, otro } : { o: elegidas };
  }
  return { ok: true, valor: { v: VERSION_MEDDPICC, respuestas } };
}

/** Líneas legibles «Pregunta: respuesta» de lo guardado (Clientify y el CSV del panel). [] si no hay respuestas. */
export function resumenMeddpicc(guardado, segmento) {
  const r = guardado && guardado.respuestas;
  if (!r || typeof r !== 'object') return [];
  const res = residencial(segmento);
  return PREGUNTAS.filter((p) => r[p.id] && Array.isArray(r[p.id].o)).map((p) => {
    const textos = r[p.id].o.map((id) => {
      const o = p.opciones.find((x) => x.id === id);
      if (!o) return id;
      const t = res && o.tRes ? o.tRes : o.t;
      return o.otro && r[p.id].otro ? t + ' (' + r[p.id].otro + ')' : t;
    });
    return p.t + ' ' + textos.join(', ');
  });
}
