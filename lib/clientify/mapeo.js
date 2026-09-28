// Mapeo Hub ↔ Clientify (CLAUDE.md §8). Es el ÚNICO lugar con nombres de Clientify:
// etiquetas, campos personalizados y, en la fase 6, textos de Status y fases de oportunidad.
// Si Clientify cambia un nombre, se ajusta aquí.

/** Campo personalizado que ya existe en Clientify y guarda el codigo_aliado. */
export const CAMPO_ID_ALIADO = 'ID_aliado';

/** Etiqueta común a todos los aliados. */
export const ETIQUETA_ALIADO = 'Aliado del Sol';

/** Etiqueta por tipo de aliado (tipo_aliado → etiqueta en Clientify). Pendiente de confirmar con el equipo. */
export const ETIQUETAS_TIPO = {
  financiero: 'AdS Financieros',
  emi: 'AdS EMI',
  linker: 'AdS Linker',
  cliente_embajador: 'AdS Cliente Embajador',
  agremiaciones: 'AdS Agremiaciones'
};

/** Etiquetas del flujo B (§8): Clientify continúa su proceso existente según la etiqueta. */
export const ETIQUETA_REFERIDO_PERFECTO = 'Referido perfecto';
export const ETIQUETA_REFERIDO_IMPERFECTO = 'Referido imperfecto';

/** Clientify es uno solo para pruebas y producción (§10): lo creado fuera de Production se marca así. */
export const ETIQUETA_PRUEBA = 'PRUEBA HUB';
export const MARCA_CORREO_PRUEBA = '+prueba';

// ---------------------------------------------------------------------------------------------------
// Flujo C (fase 6): Status del contacto, fases de la oportunidad, etiquetas y campos (CLAUDE.md §8).
// Los textos se comparan normalizados (minúsculas, sin tildes, espacios simples).
// ---------------------------------------------------------------------------------------------------

/** A. Status del contacto → calificado. 'sin_cambio': conserva el valor anterior. */
export const ESTADOS_CONTACTO = {
  '0. lead no calificado': 'no',
  '3. lead caliente': 'si',
  '4. en oportunidad': 'si',
  '5. cliente': 'si',
  '0. contacto alternativo': 'revision',
  '0. lead verificado': 'revision',
  '1. lead frio': 'revision',
  '2. lead templado': 'revision',
  '0. lead perdido': 'revision',
  '0. cliente perdido': 'sin_cambio'
};

/** B. Fases del pipeline (la 8 no existe). Se usa el número del prefijo ("3. Diseño" → 3). */
export const FASES_OPORTUNIDAD = {
  1: 'Diseña tu proyecto',
  2: 'Agendamiento visita técnica',
  3: 'Diseño',
  4: 'Modelamiento de PPA',
  5: 'Asignación de presentación',
  6: 'Presentación de oferta',
  7: 'Interesado No ahora',
  9: 'Financiación',
  10: 'Contrato'
};
export const FASE_EVALUACION_TECNICA = 3;
export const FASE_PROPUESTA_COMERCIAL = 6;
export const FASE_NEGOCIO_CERRADO = 10;

/** C. Etiqueta de información falsa. PENDIENTE: nombre exacto (§14, pregunta 1). Mientras sea null, la variable queda en revisión. */
export const ETIQUETA_INFORMACION_FALSA = null;

/** D. Campos personalizados de la oportunidad. PENDIENTE de confirmar con /api/cron/clientify-diagnostico (§14, pregunta 2). */
export const CAMPO_POTENCIA_KWP = null;
export const CAMPO_VALOR_COTIZADO = null;

// Lectura de los objetos de la API. POR CONFIRMAR con el diagnóstico: si un nombre difiere, se ajusta solo aquí.

const texto = (v) => (v == null ? null : typeof v === 'object' ? (v.name ?? v.label ?? v.value ?? null) : String(v));
const primero = (...valores) => valores.map(texto).find((v) => v != null && String(v).trim() !== '') ?? null;
const numero = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const idDeUrl = (v, recurso) => {
  if (v == null) return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) return String(v);
  if (typeof v === 'object') return idDeUrl(v.id ?? v.url, recurso);
  const m = String(v).match(new RegExp(`/${recurso}/(\\d+)`));
  return m ? m[1] : null;
};
const nombresDeEtiquetas = (tags) => (Array.isArray(tags) ? tags.map(texto).filter(Boolean) : []);
const camposPersonalizados = (lista) => (Array.isArray(lista) ? lista : [])
  .map((c) => ({ campo: primero(c && (c.field ?? c.name ?? c.label)), valor: c && (c.value ?? c.val ?? null) }))
  .filter((c) => c.campo);
const valorCampo = (campos, nombre) => (nombre ? campos.find((c) => c.campo === nombre)?.valor ?? null : null);

export function leerContacto(c) {
  const campos = camposPersonalizados(c.custom_fields);
  return {
    id: c.id != null ? String(c.id) : null,
    nombre: [texto(c.first_name), texto(c.last_name)].filter(Boolean).join(' ').trim() || null,
    correo: primero(c.email, ...(c.emails || []).map((e) => e && e.email)),
    telefono: primero(c.phone, ...(c.phones || []).map((p) => p && p.phone)),
    empresa: primero(c.company_name, c.company_details && c.company_details.name),
    cargo: primero(c.title),
    status: primero(c.status_display, c.status_name, c.status),
    etiquetas: nombresDeEtiquetas(c.tags),
    idAliado: primero(valorCampo(campos, CAMPO_ID_ALIADO)),
    leadScoring: numero(c.lead_scoring ?? c.score),
    campos
  };
}

/** Estado nativo de la oportunidad → abierta | ganada | perdida. */
const ESTADOS_OPORTUNIDAD = { 1: 'abierta', 2: 'ganada', 3: 'perdida', open: 'abierta', won: 'ganada', lost: 'perdida',
  abierta: 'abierta', ganada: 'ganada', perdida: 'perdida' };

export function leerOportunidad(d) {
  const campos = camposPersonalizados(d.custom_fields);
  const contactos = [d.contact, ...(Array.isArray(d.contacts) ? d.contacts : [])].map((c) => idDeUrl(c, 'contacts')).filter(Boolean);
  const estado = primero(d.status_desc, d.status);
  return {
    id: d.id != null ? String(d.id) : null,
    contactos: [...new Set(contactos)],
    fase: primero(d.pipeline_stage_desc, d.stage_name, d.pipeline_stage_name, d.stage),
    estado: estado == null ? null : ESTADOS_OPORTUNIDAD[String(estado).trim().toLowerCase()] ?? null,
    valor: numero(d.amount ?? d.value),
    valorCotizado: numero(valorCampo(campos, CAMPO_VALOR_COTIZADO)),
    potenciaKwp: numero(valorCampo(campos, CAMPO_POTENCIA_KWP))
  };
}

/**
 * Webhook → { entidad: 'contacto' | 'oportunidad' | null, entidadId, accion }.
 * El formato exacto del webhook está POR CONFIRMAR: se aceptan las variantes habituales y, en último caso,
 * se busca la URL del recurso en el cuerpo.
 */
export function interpretarWebhook(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const hook = p.hook && typeof p.hook === 'object' ? p.hook : {};
  const accion = primero(hook.event, p.event, p.action, p.type, p.event_type) || null;
  const datos = (p.data && typeof p.data === 'object' ? p.data : null) || (p.object && typeof p.object === 'object' ? p.object : null) || p;
  const modelo = String(primero(hook.model, p.model, p.object_type, p.entity) || accion || '').toLowerCase();

  let entidad = /deal|oportunidad/.test(modelo) ? 'oportunidad' : /contact/.test(modelo) ? 'contacto' : null;
  let entidadId = datos.id != null && /^\d+$/.test(String(datos.id)) ? String(datos.id) : null;

  if (!entidad || !entidadId) {
    const m = JSON.stringify(p).match(/\/(contacts|deals)\/(\d+)\//);
    if (m) {
      entidad = entidad || (m[1] === 'deals' ? 'oportunidad' : 'contacto');
      entidadId = entidadId || m[2];
    }
  }
  return entidad && entidadId ? { entidad, entidadId, accion } : { entidad: null, entidadId: null, accion };
}
