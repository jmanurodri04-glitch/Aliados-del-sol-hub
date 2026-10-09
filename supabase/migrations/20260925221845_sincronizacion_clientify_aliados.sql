-- Fase 4 · 01 — Cola de sincronización aliado → Clientify (CLAUDE.md §3, §8 flujo A).
--
-- Solo se sincronizan aliados `activo` (GEENERA los aprobó). La función de servidor
-- /api/cron/clientify-aliados reclama un lote, crea o actualiza el contacto en Clientify
-- y registra el resultado. Si falla, reintenta con espera creciente (backoff).
-- Ni el registro ni la aprobación fallan por culpa de Clientify.

alter table public.aliados
  add column clientify_sync_intentos   integer not null default 0 check (clientify_sync_intentos >= 0),
  add column clientify_sync_proximo_at timestamptz,  -- NULL: listo para intentar; también sirve de "préstamo" mientras se procesa
  add column clientify_sync_at         timestamptz;  -- última sincronización exitosa

create index aliados_clientify_pendientes_idx on public.aliados (clientify_sync_proximo_at nulls first)
  where estado = 'activo' and clientify_sync_estado in ('pendiente', 'error');

-- Si un aliado ya sincronizado cambia datos que viven en Clientify, se vuelve a sincronizar (§8: "cuando
-- el aliado edita su perfil, también se replica en Clientify").
create function interno.aliados_marcar_resincronizacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.clientify_sync_estado = 'ok' then
    new.clientify_sync_estado := 'pendiente';
    new.clientify_sync_intentos := 0;
    new.clientify_sync_proximo_at := null;
  end if;
  return new;
end;
$$;

create trigger aliados_marcar_resincronizacion
  before update of nombre_completo, correo, celular, regional, tipo_aliado on public.aliados
  for each row
  when ((new.nombre_completo, new.correo, new.celular, new.regional, new.tipo_aliado)
        is distinct from (old.nombre_completo, old.correo, old.celular, old.regional, old.tipo_aliado))
  execute function interno.aliados_marcar_resincronizacion();

-- También cuando cambian la organización o el cargo del perfil.
create function interno.perfil_organizacion_marcar_resincronizacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.aliados a
  set clientify_sync_estado = 'pendiente', clientify_sync_intentos = 0, clientify_sync_proximo_at = null
  where a.id = new.aliado_id and a.clientify_sync_estado = 'ok';
  return null;
end;
$$;

create trigger aliados_perfil_organizacion_marcar_resincronizacion
  after update of organizacion, cargo on public.aliados_perfil_organizacion
  for each row
  when ((new.organizacion, new.cargo) is distinct from (old.organizacion, old.cargo))
  execute function interno.perfil_organizacion_marcar_resincronizacion();

-- Reclama hasta p_limite aliados listos para sincronizar. Los marca con un préstamo de 10 minutos
-- para que dos ejecuciones simultáneas no procesen el mismo aliado (FOR UPDATE SKIP LOCKED).
-- Devuelve solo lo que Clientify necesita; `aliado_id` es interno y nunca se envía a Clientify.
create function public.clientify_reclamar_aliados(p_limite integer default 10)
returns table (
  aliado_id            uuid,
  codigo_aliado        text,
  nombre_completo      text,
  correo               text,
  celular              text,
  regional             text,
  tipo_aliado          public.tipo_aliado,
  organizacion         text,
  cargo                text,
  clientify_contact_id text,
  intentos             integer
)
language sql
set search_path = ''
as $$
  with elegidos as (
    select a.id
    from public.aliados a
    where a.estado = 'activo'
      and a.clientify_sync_estado in ('pendiente', 'error')
      and (a.clientify_sync_proximo_at is null or a.clientify_sync_proximo_at <= now())
    order by a.clientify_sync_proximo_at nulls first, a.aprobado_at nulls first
    limit greatest(1, least(coalesce(p_limite, 10), 50))
    for update of a skip locked
  ),
  prestados as (
    update public.aliados a
    set clientify_sync_proximo_at = now() + interval '10 minutes'
    from elegidos e
    where a.id = e.id
    returning a.*
  )
  select p.id, p.codigo_aliado, p.nombre_completo, p.correo, p.celular, p.regional, p.tipo_aliado,
         o.organizacion, o.cargo, p.clientify_contact_id, p.clientify_sync_intentos
  from prestados p
  left join public.aliados_perfil_organizacion o on o.aliado_id = p.id;
$$;

-- Registra el resultado de sincronizar un aliado.
--   Éxito: guarda el ID del contacto y deja el aliado en 'ok'.
--   Error: 'error', guarda el motivo y programa el reintento: 15 min, 30, 1 h, 2 h… hasta un máximo de 24 h.
create function public.clientify_registrar_resultado(p_aliado uuid, p_contact_id text, p_error text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_error is null then
    if p_contact_id is null or btrim(p_contact_id) = '' then
      raise exception 'Se requiere el ID del contacto de Clientify para registrar un éxito';
    end if;
    update public.aliados a
    set clientify_contact_id      = p_contact_id,
        clientify_sync_estado     = 'ok',
        clientify_sync_error      = null,
        clientify_sync_intentos   = 0,
        clientify_sync_proximo_at = null,
        clientify_sync_at         = now()
    where a.id = p_aliado;
  else
    update public.aliados a
    set clientify_contact_id      = coalesce(p_contact_id, a.clientify_contact_id),
        clientify_sync_estado     = 'error',
        clientify_sync_error      = left(p_error, 500),
        clientify_sync_intentos   = a.clientify_sync_intentos + 1,
        clientify_sync_proximo_at = now() + least(interval '15 minutes' * power(2, least(a.clientify_sync_intentos, 10)), interval '24 hours')
    where a.id = p_aliado;
  end if;
end;
$$;

-- Solo el servidor (secret key → service_role) sincroniza.
revoke execute on function public.clientify_reclamar_aliados(integer) from public, anon, authenticated;
revoke execute on function public.clientify_registrar_resultado(uuid, text, text) from public, anon, authenticated;
grant execute on function public.clientify_reclamar_aliados(integer) to service_role;
grant execute on function public.clientify_registrar_resultado(uuid, text, text) to service_role;
revoke execute on function interno.aliados_marcar_resincronizacion() from public, anon, authenticated;
revoke execute on function interno.perfil_organizacion_marcar_resincronizacion() from public, anon, authenticated;
