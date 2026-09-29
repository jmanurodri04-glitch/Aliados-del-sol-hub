-- Fase 8 · 01 — Vistas del dashboard del aliado (CLAUDE.md §4.12, §9).
--
-- Vistas de solo lectura para el Hub. Son `security_invoker`: aplican el RLS de las tablas de base, y
-- además filtran por auth.uid(), así cada aliado (también un admin) ve solo lo suyo. Ninguna expone
-- aliados.id ni aliado_id (§2). El panel de administración (fase 9) tendrá sus propias vistas.

-- Resumen del aliado ------------------------------------------------------------------------------------

create view public.v_aliado_dashboard
with (security_invoker = true)
as
select
  a.codigo_aliado,
  a.nombre_completo,
  a.correo,
  a.celular,
  a.regional,
  a.tipo_aliado,
  a.estado,
  a.created_at,
  a.aprobado_at,
  po.organizacion,
  po.cargo,
  pa.como_llega_empresas,
  -- Puntos, nivel y calidad (caché del libro mayor, §5.4 y §6).
  a.puntos_nivel,
  a.puntos_disponibles,
  a.nivel,
  a.calidad_referidos,
  coalesce(r.evaluadas, 0)::integer                   as empresas_evaluadas,
  -- Racha Solar 4x4 (§5.2). racha_semana_actual: la semana en curso ya está contada.
  a.racha_semana_1,
  a.racha_semana_2,
  a.racha_semana_3,
  a.racha_semana_4,
  a.racha_ultima_semana,
  coalesce(a.racha_ultima_semana = date_trunc('week', now() at time zone 'America/Bogota')::date, false)
                                                      as racha_semana_actual,
  -- Referidos.
  coalesce(r.total, 0)::integer                       as referidos_total,
  coalesce(r.calificados, 0)::integer                 as referidos_calificados,
  coalesce(r.propuestas, 0)::integer                  as referidos_propuesta,
  coalesce(r.cerrados, 0)::integer                    as referidos_cerrados,
  coalesce(r.no_continuan, 0)::integer                as referidos_no_continuan,
  coalesce(r.total, 0)::integer - coalesce(r.cerrados, 0)::integer - coalesce(r.no_continuan, 0)::integer
                                                      as referidos_activos,
  -- Indicadores de Financieros (§8, tabla D; en COP y kWp).
  coalesce(r.potencia_kwp, 0)                         as potencia_kwp,
  coalesce(r.pipeline_originado, 0)                   as pipeline_originado,
  coalesce(r.valor_cotizado, 0)                       as valor_cotizado,
  -- Módulos (§5.3).
  coalesce(m.pendientes, 0)::integer                  as modulos_pendientes,
  coalesce(m.completados, 0)::integer                 as modulos_completados,
  coalesce(p.puntos_modulos_mes, 0)::integer          as puntos_modulos_mes
from public.aliados a
left join public.aliados_perfil_organizacion po on po.aliado_id = a.id
left join public.aliados_perfil_alcance pa on pa.aliado_id = a.id
left join lateral (
  select
    count(*)                                                                       as total,
    count(*) filter (where av.calidad_empresa is not null)                          as evaluadas,
    count(*) filter (where av.calificado = 'si')                                    as calificados,
    count(*) filter (where av.propuesta_comercial = 'si')                           as propuestas,
    count(*) filter (where av.negocio_cerrado = 'si')                               as cerrados,
    count(*) filter (where av.negocio_cerrado is distinct from 'si'
                       and (av.calificado = 'no' or av.informacion_falsa = 'si'
                            or av.estado_oportunidad = 'perdida'))                  as no_continuan,
    sum(av.potencia_instalada_kwp)                                                  as potencia_kwp,
    sum(av.valor_oportunidad)                                                       as pipeline_originado,
    sum(av.valor_cotizado)                                                          as valor_cotizado
  from public.empresas e
  left join public.avance_empresa av on av.empresa_id = e.id
  where e.aliado_id = a.id
) r on true
left join lateral (
  select
    count(*) filter (where mc.recompensa_estado = 'pendiente')                      as pendientes,
    count(*)                                                                       as completados
  from public.modulos_completados mc
  where mc.aliado_id = a.id
) m on true
left join lateral (
  select sum(mv.puntos) as puntos_modulos_mes
  from public.movimientos_puntos mv
  where mv.aliado_id = a.id
    and mv.motivo = 'modulo_completado'
    and mv.fecha >= date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota'
) p on true
where a.id = (select auth.uid());

comment on view public.v_aliado_dashboard is 'Resumen del aliado de la sesión para el Hub (sin id). Montos en COP.';

-- Historial de Puntos Sol ------------------------------------------------------------------------------

create view public.v_mis_movimientos
with (security_invoker = true)
as
select
  m.secuencia,
  m.fecha,
  m.tipo,
  m.motivo,
  r.descripcion,
  m.puntos,
  m.puntos_aplicados,
  m.vinculo,
  e.id       as empresa_id,
  e.empresa,
  mo.codigo  as modulo_codigo,
  mo.nombre  as modulo,
  m.nota
from public.movimientos_puntos m
join public.reglas_puntos r on r.motivo = m.motivo
left join public.empresas e
  on m.vinculo = 'empresas'
 and e.id = case when m.vinculo_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then m.vinculo_id::uuid end
left join public.modulos_completados mc
  on m.vinculo = 'modulos_completados'
 and mc.id = case when m.vinculo_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then m.vinculo_id::uuid end
left join public.modulos mo on mo.id = mc.modulo_id
where m.aliado_id = (select auth.uid());

comment on view public.v_mis_movimientos is 'Historial de Puntos Sol del aliado de la sesión: valor nominal y aplicado (§5.4).';

-- Referidos y su avance -----------------------------------------------------------------------------------

create view public.v_mis_referidos
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
  coalesce(pts.neto, 0)::integer         as puntos
from public.empresas e
left join public.avance_empresa av on av.empresa_id = e.id
left join lateral (
  select sum(case when m.tipo = 'ganado' then m.puntos else -m.puntos end) as neto
  from public.movimientos_puntos m
  where m.aliado_id = e.aliado_id
    and m.vinculo = 'empresas'
    and m.vinculo_id = e.id::text
) pts on true
where e.aliado_id = (select auth.uid());

comment on view public.v_mis_referidos is 'Empresas referidas por el aliado de la sesión, con su avance, etapa visible y puntos (valor nominal).';

-- Módulos de Academy -----------------------------------------------------------------------------------

create view public.v_mis_modulos
with (security_invoker = true)
as
select
  mo.codigo,
  mo.nombre,
  mo.orden,
  mo.puntos,
  mc.fecha_completado,
  mc.puntos             as puntos_al_completar,
  mc.recompensa_estado,
  mc.fecha_otorgada
from public.modulos mo
left join public.modulos_completados mc
  on mc.modulo_id = mo.id
 and mc.aliado_id = (select auth.uid())
where mo.activo;

comment on view public.v_mis_modulos is 'Catálogo de módulos activos con el estado del aliado de la sesión en cada uno.';

-- El historial se consulta por aliado y fecha; los referidos, por vínculo.
create index if not exists movimientos_puntos_vinculo_idx
  on public.movimientos_puntos (aliado_id, vinculo, vinculo_id);

-- Privilegios: solo lectura para la sesión del aliado.
revoke all on public.v_aliado_dashboard, public.v_mis_movimientos, public.v_mis_referidos, public.v_mis_modulos
  from public, anon, authenticated;
grant select on public.v_aliado_dashboard, public.v_mis_movimientos, public.v_mis_referidos, public.v_mis_modulos
  to authenticated, service_role;
