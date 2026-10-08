-- Aviso a n8n de cada referido imperfecto nuevo (decisión del equipo, oct 2026; CLAUDE.md §7.4).
--
-- n8n cobra una ejecución por cada llamada a su webhook, aunque la descarte. Por eso el filtro está en el Hub: solo los
-- referidos **imperfectos** nuevos del Hub (origen 'hub': Nueva oportunidad y formulario público) entran a la cola
-- `avisos_n8n`; los perfectos nunca llegan a n8n. El aviso se envía cuando el referido ya está en Clientify
-- (clientify_contact_id), porque el flujo de n8n busca el lead allí. Lo envía el servidor (/api/oportunidades y el cron)
-- con reintentos, y el panel muestra los que no se pudieron enviar, igual que los correos (§7.3).

alter table public.acciones_admin
  drop constraint acciones_admin_accion_check,
  add constraint acciones_admin_accion_check check (accion in (
    'aprobar_aliado', 'rechazar_aliado', 'suspender_aliado', 'reactivar_aliado',
    'ajuste_puntos', 'baja_calidad', 'validar_evento', 'rechazar_evento', 'resolver_conflicto',
    'anular_canje', 'guardar_recompensa', 'invitar_operador', 'estado_operador', 'eliminar_operador',
    'otorgar_meddpicc', 'reintentar_correo', 'reintentar_aviso_n8n'));

create table public.avisos_n8n (
  empresa_id  uuid primary key references public.empresas (id) on delete cascade,
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'error')),
  intentos    integer not null default 0,
  proximo_at  timestamptz not null default now(),       -- 'infinity' = ya no se reintenta solo (se reintenta desde el panel)
  error       text,                                     -- motivo del último fallo (sin datos personales)
  enviado_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.avisos_n8n is 'Aviso a n8n de cada referido imperfecto nuevo del Hub (solo el servidor escribe; un admin lee).';
create index avisos_n8n_cola_idx on public.avisos_n8n (proximo_at) where estado <> 'enviado';
alter table public.avisos_n8n enable row level security;
revoke all on public.avisos_n8n from public, anon, authenticated;
grant select on public.avisos_n8n to authenticated;
create policy avisos_n8n_admin on public.avisos_n8n for select to authenticated using ((select interno.es_admin()));

create trigger avisos_n8n_set_updated_at
  before update on public.avisos_n8n
  for each row execute function interno.set_updated_at();

-- Solo los imperfectos nuevos del Hub.
create function interno.encolar_aviso_n8n()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origen = 'hub' and not new.es_perfecto then
    insert into public.avisos_n8n (empresa_id) values (new.id) on conflict (empresa_id) do nothing;
  end if;
  return null;
end;
$$;
create trigger empresas_encolar_aviso_n8n
  after insert on public.empresas
  for each row execute function interno.encolar_aviso_n8n();

-- Toma los avisos listos (el referido ya está en Clientify), con préstamo de 10 minutos.
create function public.avisos_n8n_reclamar(p_limite integer default 10, p_empresa uuid default null)
returns table (
  empresa_id           uuid,
  empresa              text,
  ciudad               text,
  subsector            text,
  cargo                text,
  tiene_factura        boolean,
  nombre_contacto      text,
  telefono             text,
  correo               text,
  canal                text,
  registrado_at        timestamptz,
  clientify_contact_id text,
  codigo_aliado        text,
  intentos             integer
)
language sql
set search_path = ''
as $$
  with elegidas as (
    select v.empresa_id
    from public.avisos_n8n v
    join public.empresas e on e.id = v.empresa_id
    where v.estado in ('pendiente', 'error')
      and v.proximo_at <= now()
      and e.clientify_contact_id is not null
      and (p_empresa is null or v.empresa_id = p_empresa)
    order by v.proximo_at, v.created_at
    limit greatest(1, least(coalesce(p_limite, 10), 50))
    for update of v skip locked
  ),
  prestadas as (
    update public.avisos_n8n v
    set proximo_at = now() + interval '10 minutes'
    from elegidas x
    where v.empresa_id = x.empresa_id
    returning v.empresa_id, v.intentos
  )
  select e.id, e.empresa, e.ciudad, e.subsector, e.cargo, e.factura_id is not null, e.nombre_contacto, e.telefono, e.correo,
         e.canal, e.created_at, e.clientify_contact_id, a.codigo_aliado, p.intentos
  from prestadas p
  join public.empresas e on e.id = p.empresa_id
  join public.aliados a on a.id = e.aliado_id;
$$;

-- Guarda el resultado: igual que la cola de correos (15 min, 30, 1 h… máx. 6 h; tras 8 intentos se detiene).
create function public.avisos_n8n_resultado(p_empresa uuid, p_error text)
returns void
language sql
set search_path = ''
as $$
  update public.avisos_n8n v
  set estado     = case when p_error is null then 'enviado' else 'error' end,
      enviado_at = case when p_error is null then now() else v.enviado_at end,
      error      = left(p_error, 300),
      intentos   = v.intentos + case when p_error is null then 0 else 1 end,
      proximo_at = case
                     when p_error is null then v.proximo_at
                     when v.intentos + 1 >= 8 then 'infinity'::timestamptz
                     else now() + least(interval '15 minutes' * power(2, v.intentos), interval '6 hours')
                   end
  where v.empresa_id = p_empresa and v.estado <> 'enviado';
$$;

-- Vuelve a poner en la cola un aviso que no se pudo enviar (el servidor lo intenta enseguida).
create function public.admin_reintentar_aviso_n8n(p_admin uuid, p_empresa uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_aviso  public.avisos_n8n%rowtype;
  v_aliado public.aliados%rowtype;
begin
  select * into v_aviso from public.avisos_n8n v where v.empresa_id = p_empresa for update;
  if not found then
    raise exception 'empresa_inexistente: este referido no tiene aviso a n8n';
  end if;
  if v_aviso.estado = 'enviado' then
    raise exception 'estado_invalido: este aviso ya se envió';
  end if;
  update public.avisos_n8n v set estado = 'pendiente', intentos = 0, proximo_at = now(), error = null
  where v.empresa_id = p_empresa;
  select a.* into v_aliado from public.aliados a join public.empresas e on e.aliado_id = a.id where e.id = p_empresa;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'reintentar_aviso_n8n', v_aliado.id, v_aliado.codigo_aliado,
    'empresa:' || p_empresa, jsonb_build_object('error_anterior', v_aviso.error, 'intentos', v_aviso.intentos));
  return jsonb_build_object('empresa_id', p_empresa, 'estado', 'pendiente');
end;
$$;

revoke execute on function interno.encolar_aviso_n8n() from public, anon, authenticated;
revoke execute on function public.avisos_n8n_reclamar(integer, uuid) from public, anon, authenticated;
revoke execute on function public.avisos_n8n_resultado(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_reintentar_aviso_n8n(uuid, uuid) from public, anon, authenticated;
grant execute on function public.avisos_n8n_reclamar(integer, uuid) to service_role;
grant execute on function public.avisos_n8n_resultado(uuid, text) to service_role;
grant execute on function public.admin_reintentar_aviso_n8n(uuid, uuid) to service_role;

-- Avisos no enviados: con error, o pendientes de más de 30 minutos (el motivo dice si aún esperan a Clientify).
create view public.v_admin_avisos_n8n
with (security_invoker = true)
as
select v.empresa_id, e.empresa, a.codigo_aliado, a.nombre_completo, v.estado, v.intentos,
       coalesce(v.error, case when e.clientify_contact_id is null then 'Esperando que el referido llegue a Clientify' end) as error,
       v.created_at, v.updated_at,
       case when v.proximo_at = 'infinity'::timestamptz then null else v.proximo_at end as proximo_at
from public.avisos_n8n v
join public.empresas e on e.id = v.empresa_id
join public.aliados a on a.id = e.aliado_id
where (select interno.es_admin())
  and (v.estado = 'error' or (v.estado = 'pendiente' and v.created_at < now() - interval '30 minutes'));

create or replace view public.v_admin_resumen
with (security_invoker = true)
as
select
  (select count(*) from public.aliados a where a.estado = 'activo')::integer                         as aliados_activos,
  (select count(*) from public.aliados a where a.estado = 'pendiente')::integer                      as aliados_pendientes,
  (select count(*) from public.aliados a where a.estado = 'suspendido')::integer                     as aliados_suspendidos,
  (select count(*) from public.aliados a where a.estado = 'rechazado')::integer                      as aliados_rechazados,
  (select coalesce(jsonb_object_agg(t.tipo_aliado, t.n), '{}'::jsonb)
     from (select a.tipo_aliado, count(*) as n from public.aliados a where a.estado = 'activo' group by 1) t) as activos_por_tipo,
  (select count(*) from public.empresas)::integer                                                    as referidos_total,
  (select count(*) from public.avance_empresa v where v.calificado = 'si')::integer                   as referidos_calificados,
  (select count(*) from public.avance_empresa v where v.propuesta_comercial = 'si')::integer          as referidos_propuesta,
  (select count(*) from public.avance_empresa v where v.negocio_cerrado = 'si')::integer              as referidos_cerrados,
  (select coalesce(sum(v.valor_cotizado), 0) from public.avance_empresa v)                           as valor_cotizado,
  (select coalesce(sum(v.valor_oportunidad), 0) from public.avance_empresa v)                        as pipeline_originado,
  (select coalesce(sum(v.potencia_instalada_kwp), 0) from public.avance_empresa v)                   as potencia_kwp,
  (select round(avg(a.calidad_referidos), 2) from public.aliados a where a.calidad_referidos is not null) as calidad_promedio,
  (select count(*) from public.eventos e where e.estado = 'pendiente')::integer                       as eventos_pendientes,
  (select count(*) from public.avance_conflictos c where c.resuelto_at is null)::integer              as conflictos_abiertos,
  (select coalesce(sum(m.puntos_aplicados) filter (where m.tipo = 'ganado'), 0)
     from public.movimientos_puntos m
     where m.fecha >= date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota')::integer as puntos_otorgados_mes,
  (select count(*) from public.aliados a where a.racha_semana_4)::integer                            as rachas_completas,
  (select count(*) from public.canjes c where c.estado = 'confirmado'
     and c.fecha >= date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota')::integer as canjes_mes,
  (select coalesce(sum(c.puntos), 0) from public.canjes c where c.estado = 'confirmado'
     and c.fecha >= date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota')::integer as puntos_redimidos_mes,
  (select count(*) from public.recompensas r where r.activa)::integer                                as recompensas_activas,
  (select count(*) from public.correos_referido c
     where c.estado = 'error' or (c.estado = 'pendiente' and c.created_at < now() - interval '10 minutes'))::integer as correos_no_enviados,
  (select count(*) from public.avisos_n8n v
     where v.estado = 'error' or (v.estado = 'pendiente' and v.created_at < now() - interval '30 minutes'))::integer as avisos_n8n_no_enviados
where (select interno.es_admin());

revoke all on public.v_admin_avisos_n8n from public, anon, authenticated;
grant select on public.v_admin_avisos_n8n to authenticated;
