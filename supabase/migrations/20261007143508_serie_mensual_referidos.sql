-- Serie mensual real del dashboard de gestión (decisión del equipo, oct 2026; CLAUDE.md §9).
--
-- «COP cotizados y kWp por mes» deja de ser de demostración. Clientify no da la fecha en que una oportunidad
-- cambió de fase, pero el Hub sí la registra: es la fecha del movimiento de puntos de ese hito. La vista de
-- referidos expone dos fechas nuevas (al final, para poder usar create or replace):
--   * fecha_propuesta: cuándo el referido llegó a «Presentación de oferta» (movimiento propuesta_comercial);
--     su valor_cotizado cuenta en ese mes;
--   * fecha_cierre: cuándo llegó a «Contrato» (movimiento negocio_cerrado); su potencia cuenta en ese mes.
-- Un referido que ya había pasado esas fases antes del programa cae en el mes en que el Hub lo detectó (el Hub
-- lo explica con una nota en el panel). La vista sigue filtrando por el aliado de la sesión.

create or replace view public.v_mis_referidos
with (security_invoker = true)
as
select
  e.id                                   as empresa_id,
  e.origen,
  e.empresa,
  e.sector,
  e.subsector,
  e.ciudad,
  e.nombre_contacto,
  e.cargo,
  e.telefono,
  e.correo,
  e.valor_factura,
  e.observaciones,
  e.es_perfecto,
  e.factura_id is not null               as tiene_factura,
  e.created_at,
  greatest(e.updated_at, av.updated_at)  as actualizado_at,
  av.calificado,
  av.perfecto,
  av.oportunidad_tecnica,
  av.propuesta_comercial,
  av.negocio_cerrado,
  av.informacion_falsa,
  av.fuera_perfil,
  av.integridad_informacion,
  av.calidad_empresa,
  av.fecha_calificado,
  av.estado_oportunidad,
  av.potencia_instalada_kwp,
  av.valor_oportunidad,
  av.valor_cotizado,
  -- Etapa que ve el aliado (ids de OPPORTUNITY_STAGE_CONFIG en el Hub). La evaluación técnica es una
  -- etapa interna: el Hub la muestra como "Evaluación en curso".
  case
    when av.negocio_cerrado = 'si'                                                   then 'cerrado'
    when av.informacion_falsa = 'si' or av.calificado = 'no'
         or av.estado_oportunidad = 'perdida'                                        then 'noviable'
    when av.propuesta_comercial = 'si'                                               then 'propuesta'
    when av.oportunidad_tecnica = 'si'                                               then 'dtp'
    when av.calificado = 'si'                                                        then 'calificacion'
    when e.clientify_contact_id is not null                                          then 'validacion'
    else 'recibida'
  end                                    as etapa,
  coalesce(pts.neto, 0)::integer         as puntos,
  -- Serie mensual del dashboard de gestión (oct 2026): cuándo el referido llegó a la oferta y al contrato.
  hitos.fecha_propuesta,
  hitos.fecha_cierre
from public.empresas e
left join public.avance_empresa av on av.empresa_id = e.id
left join lateral (
  select sum(case when m.tipo = 'ganado' then m.puntos else -m.puntos end) as neto
  from public.movimientos_puntos m
  where m.aliado_id = e.aliado_id
    and m.vinculo = 'empresas'
    and m.vinculo_id = e.id::text
) pts on true
left join lateral (
  select min(m.fecha) filter (where m.motivo = 'propuesta_comercial') as fecha_propuesta,
         min(m.fecha) filter (where m.motivo = 'negocio_cerrado')     as fecha_cierre
  from public.movimientos_puntos m
  where m.aliado_id = e.aliado_id
    and m.vinculo = 'empresas'
    and m.vinculo_id = e.id::text
    and m.motivo in ('propuesta_comercial', 'negocio_cerrado')
) hitos on true
where e.aliado_id = (select auth.uid());
