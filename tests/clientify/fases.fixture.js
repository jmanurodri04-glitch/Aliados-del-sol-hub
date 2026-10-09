// Catálogo real de fases de Clientify (diagnóstico de la fase 6, /deals/pipelines/stages/): solo nombres y posiciones.
const EMBUDOS = {
  35689: 'Por defecto', 38124: 'GEENERA AUTOCONSUMO', 103574: 'GEENERA_Care', 113031: 'GEENERA_ADS',
  131843: 'GEENERA MINIGRANJAS', 131856: 'GEENERA OFF GRID'
};
const FASES = [
  [147918, 'Entrevista de evaluación', 35689, 0], [147919, 'Contacto realizado', 35689, 1],
  [147920, 'Producto/servicio presentado', 35689, 2], [147921, 'Propuesta presentada', 35689, 3],
  [159038, '1. Diseña Tu Proyecto', 38124, 0], [350404, '2. Agendamiento Visita Tecnica', 38124, 1],
  [159064, '3. Diseño', 38124, 2], [207016, '4. Modelamiento de PPA', 38124, 3],
  [213888, '5. Asignación de presentación', 38124, 4], [159065, '6. Presentación de Oferta', 38124, 5],
  [445722, '7. Interesado no ahora', 38124, 6], [159066, '9. Financiación', 38124, 7], [162063, '10. Contrato', 38124, 8],
  [459738, 'Oportunidad', 103574, 0], [459739, 'Diseño', 103574, 1], [459740, 'Capex', 103574, 2],
  [459741, 'Modelado de Financiación', 103574, 3], [459742, 'Asignación de presentación', 103574, 4],
  [459743, 'Presentación de Oferta', 103574, 5], [459744, 'Actualización de Oferta', 103574, 6],
  [459745, 'Financiación', 103574, 7], [459746, 'Interesado NO ahora', 103574, 8], [459747, 'Contrato', 103574, 9],
  [502449, 'Reunion de presentacion', 113031, 0], [502450, 'Convocatoria', 113031, 1], [502451, 'Logística', 113031, 2],
  [502452, 'Durante', 113031, 3], [502453, 'Cierre', 113031, 4],
  [587411, 'Identificación de Negocio', 131843, 0], [587412, 'Diseño', 131843, 1],
  [587413, 'Asignación de presentación de oferta', 131843, 2], [587414, 'Presentación de oferta', 131843, 3],
  [587415, 'Interesado No ahora', 131843, 4], [587416, 'Actualización de Oferta', 131843, 5],
  [587417, 'Financiación', 131843, 6], [587418, 'Contrato', 131843, 7],
  [587475, '1. Oportunidad', 131856, 0], [587476, '2. Diseño', 131856, 1], [587477, '3. Capex', 131856, 2],
  [587478, '4. Modelado de Financiación', 131856, 3], [587479, '5. Asignación de presentación', 131856, 4],
  [587480, '6. Presentación de Oferta', 131856, 5], [587481, '7. Interesado no ahora', 131856, 6],
  [587482, '8. Actualización de Oferta', 131856, 7], [587483, '9. Financiación', 131856, 8], [587484, '10. Contrato', 131856, 9]
];

export const FASES_CLIENTIFY = FASES.map(([id, name, embudo, position]) => ({
  id, name, position, pipeline: `https://api.clientify.net/v1/deals/pipelines/${embudo}/`, pipeline_desc: EMBUDOS[embudo]
}));

/** Oportunidad en formato de la API para una fase del catálogo (por embudo y nombre). */
export function oportunidadEnFase(embudo, nombreFase, extra = {}) {
  const f = FASES_CLIENTIFY.find((x) => x.pipeline_desc === embudo && x.name === nombreFase);
  if (!f) throw new Error(`Fase inexistente en el catálogo: ${embudo} / ${nombreFase}`);
  return {
    id: 1, contact: 'https://api.clientify.net/v1/contacts/77/', pipeline: f.pipeline, pipeline_desc: embudo,
    pipeline_stage: `https://api.clientify.net/v1/deals/pipelines/stages/${f.id}/`, pipeline_stage_desc: f.name,
    status: 1, status_desc: 'Open', amount: '1000.00', custom_fields: [], ...extra
  };
}
