-- MEDDPICC y correo de confirmación de cada referido (decisión del equipo, oct 2026; CLAUDE.md §5, §7).
--
-- 1. Regla `meddpicc` (+20, una vez por empresa, clave empresa:{id}:meddpicc). La otorga un admin desde el panel cuando
--    el aliado envía la información MEDDPICC del referido. Solo aplica a referidos perfectos o imperfectos con ciudad.
-- 2. Cola `correos_referido`: cada referido NUEVO del Hub (Nueva oportunidad o formulario público) recibe el correo
--    «Confirmación de empresa referida», que envía /api/oportunidades con Resend (y el cron reintenta). Los referidos que
--    ya existían no lo reciben (decisión del equipo). Nunca se envía dos veces: la fila pasa a `enviado`.
-- 3. El panel muestra los correos que no se pudieron enviar, con su motivo (v_admin_correos, decisión del equipo:
--    si Resend llega a su límite, el equipo lo ve sin entrar a Resend), y puede reintentarlos.

insert into public.reglas_puntos (motivo, tipo, puntos, descripcion)
values ('meddpicc', 'ganado', 20, 'Información MEDDPICC');

alter table public.movimientos_puntos drop constraint movimientos_puntos_motivo_tipo;
alter table public.movimientos_puntos add constraint movimientos_puntos_motivo_tipo check (
  (tipo = 'ganado' and motivo in ('registro_valido', 'referido_perfecto', 'empresa_calificada', 'evaluacion_tecnica',
    'propuesta_comercial', 'negocio_cerrado', 'modulo_completado', 'evento_validado', 'racha_solar', 'ajuste_admin', 'bienvenida',
    'meddpicc'))
  or (tipo = 'perdido' and motivo in ('referido_imperfecto', 'referido_no_calificado', 'fuera_perfil', 'informacion_falsa',
    'baja_calidad_reiterada', 'ajuste_admin'))
  or (tipo = 'redimido' and motivo = 'canje')
);

alter table public.acciones_admin
  drop constraint acciones_admin_accion_check,
  add constraint acciones_admin_accion_check check (accion in (
    'aprobar_aliado', 'rechazar_aliado', 'suspender_aliado', 'reactivar_aliado',
    'ajuste_puntos', 'baja_calidad', 'validar_evento', 'rechazar_evento', 'resolver_conflicto',
    'anular_canje', 'guardar_recompensa', 'invitar_operador', 'estado_operador', 'eliminar_operador',
    'otorgar_meddpicc', 'reintentar_correo'));

-- ¿El referido aplica al MEDDPICC? Perfecto, o imperfecto con ciudad (decisión del equipo).
create function interno.aplica_meddpicc(p_es_perfecto boolean, p_ciudad text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_es_perfecto, false) or nullif(btrim(coalesce(p_ciudad, '')), '') is not null;
$$;

-- ¿Ya se otorgó (o quedó retenido) el MEDDPICC de un referido? security definer porque el panel no lee los retenidos.
create function interno.meddpicc_otorgado(p_empresa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.movimientos_puntos m where m.clave_unica = 'empresa:' || p_empresa || ':meddpicc')
      or exists (select 1 from public.movimientos_retenidos r where r.clave_unica = 'empresa:' || p_empresa || ':meddpicc');
$$;

-- Cola del correo de confirmación ------------------------------------------------------------------------------------

create table public.correos_referido (
  empresa_id  uuid primary key references public.empresas (id) on delete cascade,
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'error')),
  intentos    integer not null default 0,
  proximo_at  timestamptz not null default now(),       -- 'infinity' = ya no se reintenta solo (se reintenta desde el panel)
  error       text,                                     -- motivo del último fallo (sin datos personales)
  enviado_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.correos_referido is 'Correo «Confirmación de empresa referida» de cada referido nuevo del Hub (solo el servidor).';
create index correos_referido_cola_idx on public.correos_referido (proximo_at) where estado <> 'enviado';
alter table public.correos_referido enable row level security;
revoke all on public.correos_referido from public, anon, authenticated;
-- Solo un admin lo lee (las vistas del panel son security_invoker); nadie escribe desde el navegador.
grant select on public.correos_referido to authenticated;
create policy correos_referido_admin on public.correos_referido for select to authenticated using ((select interno.es_admin()));

create trigger correos_referido_set_updated_at
  before update on public.correos_referido
  for each row execute function interno.set_updated_at();

-- Solo los referidos nuevos registrados por el Hub (origen 'hub': Nueva oportunidad y formulario público).
create function interno.encolar_correo_referido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origen = 'hub' then
    insert into public.correos_referido (empresa_id) values (new.id) on conflict (empresa_id) do nothing;
  end if;
  return null;
end;
$$;
create trigger empresas_encolar_correo
  after insert on public.empresas
  for each row execute function interno.encolar_correo_referido();

-- Toma un lote (o una empresa) con préstamo de 10 minutos, como las colas de Clientify.
create function public.correos_referido_reclamar(p_limite integer default 10, p_empresa uuid default null)
returns table (
  empresa_id      uuid,
  empresa         text,
  ciudad          text,
  es_perfecto     boolean,
  aplica_meddpicc boolean,
  nombre_aliado   text,
  correo_aliado   text,
  codigo_aliado   text,
  estado_aliado   text,
  intentos        integer
)
language sql
set search_path = ''
as $$
  with elegidas as (
    select c.empresa_id
    from public.correos_referido c
    where c.estado in ('pendiente', 'error')
      and c.proximo_at <= now()
      and (p_empresa is null or c.empresa_id = p_empresa)
    order by c.proximo_at, c.created_at
    limit greatest(1, least(coalesce(p_limite, 10), 50))
    for update of c skip locked
  ),
  prestadas as (
    update public.correos_referido c
    set proximo_at = now() + interval '10 minutes'
    from elegidas x
    where c.empresa_id = x.empresa_id
    returning c.empresa_id, c.intentos
  )
  select e.id, e.empresa, e.ciudad, e.es_perfecto, interno.aplica_meddpicc(e.es_perfecto, e.ciudad),
         a.nombre_completo, a.correo, a.codigo_aliado, a.estado, p.intentos
  from prestadas p
  join public.empresas e on e.id = p.empresa_id
  join public.aliados a on a.id = e.aliado_id;
$$;

-- Guarda el resultado. Un fallo se reintenta a los 15 min, 30, 1 h… (máximo 6 h); tras 8 intentos se detiene y
-- queda en el panel para reintentarlo a mano.
create function public.correos_referido_resultado(p_empresa uuid, p_error text)
returns void
language sql
set search_path = ''
as $$
  update public.correos_referido c
  set estado     = case when p_error is null then 'enviado' else 'error' end,
      enviado_at = case when p_error is null then now() else c.enviado_at end,
      error      = left(p_error, 300),
      intentos   = c.intentos + case when p_error is null then 0 else 1 end,
      proximo_at = case
                     when p_error is null then c.proximo_at
                     when c.intentos + 1 >= 8 then 'infinity'::timestamptz
                     else now() + least(interval '15 minutes' * power(2, c.intentos), interval '6 hours')
                   end
  where c.empresa_id = p_empresa and c.estado <> 'enviado';
$$;

-- Acciones del panel ---------------------------------------------------------------------------------------------------

-- +20 por la información MEDDPICC de un referido (una vez por empresa). Si la cuenta no está activa, queda retenido.
create function public.admin_otorgar_meddpicc(p_admin uuid, p_empresa uuid, p_nota text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin     text := interno.exigir_admin(p_admin);
  v_nota      text := nullif(left(btrim(coalesce(p_nota, '')), 1000), '');
  v_empresa   public.empresas%rowtype;
  v_aliado    public.aliados%rowtype;
  v_clave     text;
begin
  select * into v_empresa from public.empresas e where e.id = p_empresa;
  if not found then
    raise exception 'empresa_inexistente: el referido no existe';
  end if;
  if not interno.aplica_meddpicc(v_empresa.es_perfecto, v_empresa.ciudad) then
    raise exception 'no_permitido: el MEDDPICC solo aplica a referidos perfectos o imperfectos con ciudad';
  end if;
  select * into v_aliado from public.aliados a where a.id = v_empresa.aliado_id;
  v_clave := 'empresa:' || v_empresa.id || ':meddpicc';

  if interno.meddpicc_otorgado(v_empresa.id) then
    raise exception 'estado_invalido: ya se otorgó el MEDDPICC de este referido';
  end if;
  insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por, nota)
  values (v_aliado.id, 'ganado', 'meddpicc', 'empresas', v_empresa.id::text, v_clave, 'admin:' || p_admin, v_nota)
  on conflict (clave_unica) do nothing;

  perform interno.registrar_accion_admin(p_admin, v_admin, 'otorgar_meddpicc', v_aliado.id, v_aliado.codigo_aliado,
    'empresa:' || v_empresa.id, jsonb_build_object('empresa', v_empresa.empresa, 'nota', v_nota));
  return jsonb_build_object('codigo_aliado', v_aliado.codigo_aliado, 'empresa', v_empresa.empresa, 'puntos', 20,
    'retenido', v_aliado.estado <> 'activo');
end;
$$;

-- Vuelve a poner en la cola un correo que no se pudo enviar (el servidor intenta enviarlo enseguida).
create function public.admin_reintentar_correo(p_admin uuid, p_empresa uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_correo public.correos_referido%rowtype;
  v_aliado public.aliados%rowtype;
begin
  select * into v_correo from public.correos_referido c where c.empresa_id = p_empresa for update;
  if not found then
    raise exception 'empresa_inexistente: este referido no tiene correo de confirmación';
  end if;
  if v_correo.estado = 'enviado' then
    raise exception 'estado_invalido: este correo ya se envió';
  end if;
  update public.correos_referido c set estado = 'pendiente', intentos = 0, proximo_at = now(), error = null
  where c.empresa_id = p_empresa;
  select a.* into v_aliado from public.aliados a join public.empresas e on e.aliado_id = a.id where e.id = p_empresa;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'reintentar_correo', v_aliado.id, v_aliado.codigo_aliado,
    'empresa:' || p_empresa, jsonb_build_object('error_anterior', v_correo.error, 'intentos', v_correo.intentos));
  return jsonb_build_object('empresa_id', p_empresa, 'estado', 'pendiente');
end;
$$;

revoke execute on function interno.aplica_meddpicc(boolean, text) from public, anon;
revoke execute on function interno.meddpicc_otorgado(uuid) from public, anon;
grant execute on function interno.aplica_meddpicc(boolean, text) to authenticated, service_role;  -- las usa v_admin_referidos
grant execute on function interno.meddpicc_otorgado(uuid) to authenticated, service_role;
revoke execute on function interno.encolar_correo_referido() from public, anon, authenticated;
revoke execute on function public.correos_referido_reclamar(integer, uuid) from public, anon, authenticated;
revoke execute on function public.correos_referido_resultado(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_otorgar_meddpicc(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_reintentar_correo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.correos_referido_reclamar(integer, uuid) to service_role;
grant execute on function public.correos_referido_resultado(uuid, text) to service_role;
grant execute on function public.admin_otorgar_meddpicc(uuid, uuid, text) to service_role;
grant execute on function public.admin_reintentar_correo(uuid, uuid) to service_role;

-- Vistas del panel -----------------------------------------------------------------------------------------------------

-- Correos que no se pudieron enviar (o que llevan más de 10 minutos esperando), con su motivo.
create view public.v_admin_correos
with (security_invoker = true)
as
select c.empresa_id, e.empresa, a.codigo_aliado, a.nombre_completo, c.estado, c.intentos, c.error,
       c.created_at, c.updated_at,
       case when c.proximo_at = 'infinity'::timestamptz then null else c.proximo_at end as proximo_at
from public.correos_referido c
join public.empresas e on e.id = c.empresa_id
join public.aliados a on a.id = e.aliado_id
where (select interno.es_admin())
  and (c.estado = 'error' or (c.estado = 'pendiente' and c.created_at < now() - interval '10 minutes'));

-- Referidos de cada aliado con su estado de MEDDPICC (el panel filtra por codigo_aliado). Sin aliados.id.
create view public.v_admin_referidos
with (security_invoker = true)
as
select e.id as empresa_id, a.codigo_aliado, e.empresa, e.ciudad, e.es_perfecto, e.origen, e.created_at,
       interno.aplica_meddpicc(e.es_perfecto, e.ciudad) as meddpicc_aplica,
       interno.meddpicc_otorgado(e.id) as meddpicc_otorgado,
       c.estado as correo_estado
from public.empresas e
join public.aliados a on a.id = e.aliado_id
left join public.correos_referido c on c.empresa_id = e.id
where (select interno.es_admin());

-- Resumen: se agrega el número de correos no enviados al final.
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
     where c.estado = 'error' or (c.estado = 'pendiente' and c.created_at < now() - interval '10 minutes'))::integer as correos_no_enviados
where (select interno.es_admin());

revoke all on public.v_admin_correos, public.v_admin_referidos from public, anon, authenticated;
grant select on public.v_admin_correos, public.v_admin_referidos to authenticated;
