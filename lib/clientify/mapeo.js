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

/** Clientify es uno solo para pruebas y producción (§10): lo creado fuera de Production se marca así. */
export const ETIQUETA_PRUEBA = 'PRUEBA HUB';
export const MARCA_CORREO_PRUEBA = '+prueba';
