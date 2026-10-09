-- Fase 10 · 01 — Catálogo de recompensas, canjes por API y anulación (CLAUDE.md §4.10, §6.3, §10).
--
-- Un sistema externo (proveedor) canjea puntos con POST /api/canjes y su API key (CANJES_API_KEYS). El proveedor
-- sale de la key; el aliado se identifica por codigo_aliado (nunca por aliados.id, §2). Los puntos y el nivel
-- mínimo salen del catálogo `recompensas`, que administra GEENERA desde el panel (decisión del equipo).
-- Un canje que el proveedor no entregó lo anula un admin: se devuelve el valor con un ajuste_admin (el libro
-- mayor sigue siendo solo inserción).
--
-- Además, las cuentas de admin no se sincronizan con Clientify (flujo A, decisión del equipo).
--
-- Errores con prefijo estable: dato_invalido · aliado_inexistente · aliado_no_activo · recompensa_inexistente
--   nivel_insuficiente · saldo_insuficiente · limite_canjes · referencia_duplicada · canje_inexistente
--   estado_invalido · no_autorizado

-- Catálogo de recompensas -----------------------------------------------------------------------------------------

create table public.recompensas (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique check (codigo ~ '^[a-z0-9][a-z0-9_-]{1,39}$'), -- lo usa el proveedor; inmutable
  nombre        text not null check (char_length(btrim(nombre)) between 3 and 120),
  descripcion   text check (char_length(descripcion) <= 1000),
  categoria     text check (char_length(categoria) <= 40),
  puntos        integer not null check (puntos between 1 and 100000),
  nivel_minimo  public.nivel not null default 'bronce',
  proveedor     text check (proveedor ~ '^[a-z0-9_-]{2,40}$'),                    -- NULL: cualquier proveedor
  activa        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.recompensas is 'Catálogo de recompensas canjeables con Puntos Sol (lo administra GEENERA en el panel).';

create trigger recompensas_updated_at
  before update on public.recompensas
  for each row execute function interno.set_updated_at();

-- El código lo usa el proveedor para canjear: no cambia una vez creado.
create function interno.recompensas_codigo_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.codigo is distinct from old.codigo then
    raise exception 'dato_invalido: el código de una recompensa no se puede cambiar';
  end if;
  return new;
end;
$$;

create trigger recompensas_codigo_inmutable
  before update of codigo on public.recompensas
  for each row execute function interno.recompensas_codigo_inmutable();

alter table public.recompensas enable row level security;
revoke all on table public.recompensas from anon, authenticated;
grant all on table public.recompensas to service_role;
grant select on table public.recompensas to authenticated;
-- El aliado ve el catálogo activo; un admin ve todo.
create policy recompensas_select on public.recompensas
  for select to authenticated
  using (activa or (select interno.es_admin()));

-- Canjes: vínculo con el catálogo, anulación e idempotencia por proveedor --------------------------------------------

alter table public.canjes
  add column recompensa_id     uuid references public.recompensas (id) on delete restrict,
  add column estado            text not null default 'confirmado' check (estado in ('confirmado', 'anulado')),
  add column anulado_at        timestamptz,
  add column anulado_por       uuid references public.aliados (id) on delete set null,
  add column anulacion_motivo  text check (char_length(anulacion_motivo) <= 1000),
  add constraint canjes_proveedor_formato check (proveedor ~ '^[a-z0-9_-]{2,40}$') not valid,
  add constraint canjes_referencia_formato check (char_length(referencia_externa) between 1 and 100) not valid;

-- La referencia es única por proveedor (dos proveedores pueden usar la misma numeración).
alter table public.canjes drop constraint canjes_referencia_externa_key;
alter table public.canjes add constraint canjes_proveedor_referencia_key unique (proveedor, referencia_externa);

create index canjes_recompensa_idx on public.canjes (recompensa_id) where recompensa_id is not null;
create index canjes_anulado_por_idx on public.canjes (anulado_por) where anulado_por is not null;
create index canjes_fecha_idx on public.canjes (fecha desc);

-- Un canje no se edita: solo puede pasar una vez de confirmado a anulado (o perder referencias al borrar una cuenta).
create function interno.canjes_solo_anulacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.aliados a where a.id = old.aliado_id) then
      return old; -- borrado en cascada de la cuenta (Ley 1581)
    end if;
    raise exception 'canjes no se borran; un admin puede anularlos';
  end if;
  if (new.id, new.aliado_id, new.puntos, new.recompensa, new.nivel_requerido, new.proveedor, new.referencia_externa,
      new.fecha, new.recompensa_id)
     is distinct from
     (old.id, old.aliado_id, old.puntos, old.recompensa, old.nivel_requerido, old.proveedor, old.referencia_externa,
      old.fecha, old.recompensa_id) then
    raise exception 'canjes no se editan; un admin puede anularlos';
  end if;
  if new.estado is distinct from old.estado and not (old.estado = 'confirmado' and new.estado = 'anulado') then
    raise exception 'un canje solo pasa de confirmado a anulado';
  end if;
  if old.estado = 'anulado'
     and (new.anulado_at, new.anulacion_motivo) is distinct from (old.anulado_at, old.anulacion_motivo) then
    raise exception 'la anulación de un canje no se edita';
  end if;
  if old.estado = 'anulado' and new.anulado_por is not null and new.anulado_por is distinct from old.anulado_por then
    raise exception 'la anulación de un canje no se edita';
  end if;
  return new;
end;
$$;

create trigger canjes_solo_anulacion
  before update or delete on public.canjes
  for each row execute function interno.canjes_solo_anulacion();

-- Auditoría: nuevas acciones del panel -------------------------------------------------------------------------------

alter table public.acciones_admin
  drop constraint acciones_admin_accion_check,
  add constraint acciones_admin_accion_check check (accion in (
    'aprobar_aliado', 'rechazar_aliado', 'suspender_aliado', 'reactivar_aliado',
    'ajuste_puntos', 'baja_calidad', 'validar_evento', 'rechazar_evento', 'resolver_conflicto',
    'anular_canje', 'guardar_recompensa'));

-- Canje desde el proveedor (POST /api/canjes) ----------------------------------------------------------------------

-- Registra un canje. p_proveedor sale de la API key (nunca del cuerpo). Idempotente por (proveedor, referencia):
-- repetir la misma referencia devuelve el canje original con duplicado = true y no descuenta dos veces.
create function public.registrar_canje(p_proveedor text, p_codigo text, p_recompensa text, p_referencia text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_proveedor  text := lower(btrim(coalesce(p_proveedor, '')));
  v_referencia text := btrim(coalesce(p_referencia, ''));
  v_aliado     public.aliados;
  v_recompensa public.recompensas%rowtype;
  v_previo     public.canjes%rowtype;
  v_canje      uuid;
  v_final      public.aliados%rowtype;
begin
  if v_proveedor !~ '^[a-z0-9_-]{2,40}$' then
    raise exception 'dato_invalido: proveedor inválido';
  end if;
  if char_length(v_referencia) not between 1 and 100 then
    raise exception 'dato_invalido: la referencia externa debe tener entre 1 y 100 caracteres';
  end if;

  -- Bloquea al aliado: dos canjes simultáneos no leen el mismo saldo ni duplican la referencia.
  v_aliado := interno.aliado_por_codigo(p_codigo);

  select * into v_previo from public.canjes c where c.proveedor = v_proveedor and c.referencia_externa = v_referencia;
  if found then
    if v_previo.aliado_id <> v_aliado.id
       or v_previo.recompensa_id is distinct from (select r.id from public.recompensas r where r.codigo = lower(btrim(coalesce(p_recompensa, '')))) then
      raise exception 'referencia_duplicada: la referencia % ya se usó en otro canje', v_referencia;
    end if;
    return jsonb_build_object('canje_id', v_previo.id, 'codigo_aliado', v_aliado.codigo_aliado, 'recompensa', v_previo.recompensa,
      'puntos', v_previo.puntos, 'estado', v_previo.estado, 'puntos_disponibles', v_aliado.puntos_disponibles,
      'nivel', v_aliado.nivel, 'duplicado', true);
  end if;

  if v_aliado.estado <> 'activo' then
    raise exception 'aliado_no_activo: la cuenta no está activa';
  end if;

  select * into v_recompensa from public.recompensas r
  where r.codigo = lower(btrim(coalesce(p_recompensa, ''))) and r.activa
    and (r.proveedor is null or r.proveedor = v_proveedor);
  if not found then
    raise exception 'recompensa_inexistente: la recompensa no existe, no está activa o no corresponde a este proveedor';
  end if;
  if v_aliado.nivel < v_recompensa.nivel_minimo then
    raise exception 'nivel_insuficiente: la recompensa requiere nivel % y el aliado es %', v_recompensa.nivel_minimo, v_aliado.nivel;
  end if;
  if (select count(*) from public.canjes c where c.aliado_id = v_aliado.id and c.fecha > now() - interval '1 hour') >= 30 then
    raise exception 'limite_canjes: máximo 30 canjes por hora';
  end if;
  if v_recompensa.puntos > v_aliado.puntos_disponibles then
    raise exception 'saldo_insuficiente: la recompensa vale % puntos y el saldo disponible es %', v_recompensa.puntos, v_aliado.puntos_disponibles;
  end if;

  begin
    insert into public.canjes (aliado_id, puntos, recompensa, nivel_requerido, proveedor, referencia_externa, recompensa_id)
    values (v_aliado.id, v_recompensa.puntos, v_recompensa.nombre, v_recompensa.nivel_minimo, v_proveedor, v_referencia, v_recompensa.id)
    returning id into v_canje;
  exception when unique_violation then
    -- Otro canje con la misma referencia (de otro aliado) se registró al mismo tiempo.
    raise exception 'referencia_duplicada: la referencia % ya se usó en otro canje', v_referencia;
  end;

  -- El trigger del libro mayor vuelve a validar el saldo (saldo_insuficiente) y recalcula la caché del aliado.
  insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, vinculo_id, clave_unica, creado_por, nota)
  values (v_aliado.id, 'redimido', v_recompensa.puntos, 'canje', 'canjes', v_canje::text, 'canje:' || v_canje, 'canjes_api',
          v_recompensa.nombre);

  select * into v_final from public.aliados a where a.id = v_aliado.id;
  return jsonb_build_object('canje_id', v_canje, 'codigo_aliado', v_final.codigo_aliado, 'recompensa', v_recompensa.nombre,
    'puntos', v_recompensa.puntos, 'estado', 'confirmado', 'puntos_disponibles', v_final.puntos_disponibles,
    'nivel', v_final.nivel, 'duplicado', false);
end;
$$;

-- Lo que un proveedor puede consultar antes de canjear: estado, nivel, saldo y las recompensas que puede ofrecerle.
-- No devuelve nombre, correo ni ningún dato personal.
create function public.consultar_canjes(p_proveedor text, p_codigo text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_proveedor text := lower(btrim(coalesce(p_proveedor, '')));
  v_aliado    public.aliados%rowtype;
  v_activo    boolean;
begin
  select * into v_aliado from public.aliados a where a.codigo_aliado = upper(btrim(coalesce(p_codigo, '')));
  if not found then
    raise exception 'aliado_inexistente: no existe un aliado con ese código';
  end if;
  v_activo := v_aliado.estado = 'activo';
  return jsonb_build_object(
    'codigo_aliado', v_aliado.codigo_aliado,
    'activo', v_activo,
    'nivel', v_aliado.nivel,
    'puntos_disponibles', v_aliado.puntos_disponibles,
    'recompensas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', r.codigo, 'nombre', r.nombre, 'descripcion', r.descripcion, 'categoria', r.categoria,
               'puntos', r.puntos, 'nivel_minimo', r.nivel_minimo,
               'disponible', v_activo and v_aliado.nivel >= r.nivel_minimo and v_aliado.puntos_disponibles >= r.puntos,
               'motivo', case when not v_activo then 'aliado_no_activo'
                              when v_aliado.nivel < r.nivel_minimo then 'nivel_insuficiente'
                              when v_aliado.puntos_disponibles < r.puntos then 'saldo_insuficiente' end)
             order by r.puntos, r.nombre)
      from public.recompensas r
      where r.activa and (r.proveedor is null or r.proveedor = v_proveedor)), '[]'::jsonb));
end;
$$;

-- Panel: anular un canje y administrar el catálogo ----------------------------------------------------------------------

-- La devolución de un canje anulado (ajuste_admin con vinculo = 'canjes') solo devuelve saldo: el canje no restó
-- puntos de nivel, así que la devolución tampoco los suma (§5.4). Mismo cálculo de la fase 3 con esa exclusión.
create or replace function public.calcular_puntos_nivel(p_aliado uuid, p_ahora timestamptz default now())
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_desde timestamptz := ((p_ahora at time zone 'America/Bogota') - interval '6 months') at time zone 'America/Bogota';
  v_saldo integer := 0;
  r record;
begin
  for r in
    select m.tipo, m.puntos
    from public.movimientos_puntos m
    where m.aliado_id = p_aliado
      and m.tipo in ('ganado', 'perdido')
      and m.vinculo <> 'canjes'
      and m.fecha >= v_desde
      and m.fecha <= p_ahora
    order by m.fecha, m.secuencia
  loop
    v_saldo := greatest(0, v_saldo + case when r.tipo = 'ganado' then r.puntos else -r.puntos end);
  end loop;
  return v_saldo;
end;
$$;

-- Anula un canje confirmado y devuelve sus puntos con un ajuste_admin (clave canje_anulado:{id}), aunque la
-- cuenta no esté activa (§4.7). La devolución suma a puntos_disponibles pero no a puntos_nivel: un canje no los restó.
create function public.admin_anular_canje(p_admin uuid, p_canje uuid, p_motivo text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_motivo text := interno.texto_obligatorio(p_motivo, 'el motivo', 10);
  v_canje  public.canjes%rowtype;
  v_codigo text;
begin
  select * into v_canje from public.canjes c where c.id = p_canje for update;
  if not found then
    raise exception 'canje_inexistente: el canje no existe';
  end if;
  if v_canje.estado <> 'confirmado' then
    raise exception 'estado_invalido: el canje ya fue anulado';
  end if;

  update public.canjes c
  set estado = 'anulado', anulado_at = now(), anulado_por = p_admin, anulacion_motivo = v_motivo
  where c.id = p_canje;

  insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, vinculo_id, clave_unica, creado_por, nota)
  values (v_canje.aliado_id, 'ganado', v_canje.puntos, 'ajuste_admin', 'canjes', p_canje::text, 'canje_anulado:' || p_canje,
          'admin:' || p_admin, 'Anulación del canje «' || v_canje.recompensa || '»: ' || v_motivo)
  on conflict (clave_unica) do nothing;

  select a.codigo_aliado into v_codigo from public.aliados a where a.id = v_canje.aliado_id;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'anular_canje', v_canje.aliado_id, v_codigo,
    'canje:' || p_canje, jsonb_build_object('recompensa', v_canje.recompensa, 'puntos', v_canje.puntos,
      'proveedor', v_canje.proveedor, 'referencia_externa', v_canje.referencia_externa, 'motivo', v_motivo));
  return jsonb_build_object('canje_id', p_canje, 'estado', 'anulado', 'codigo_aliado', v_codigo, 'puntos_devueltos', v_canje.puntos);
end;
$$;

-- Crea (p_recompensa null) o edita una recompensa. Cambiar los puntos o el nivel solo afecta los canjes futuros:
-- cada canje guarda los puntos y el nivel con que se hizo.
create function public.admin_guardar_recompensa(p_admin uuid, p_recompensa uuid, p_datos jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin     text := interno.exigir_admin(p_admin);
  v_datos     jsonb := coalesce(p_datos, '{}'::jsonb);
  v_codigo    text := lower(btrim(coalesce(v_datos ->> 'codigo', '')));
  v_nombre    text := btrim(coalesce(v_datos ->> 'nombre', ''));
  v_desc      text := nullif(btrim(coalesce(v_datos ->> 'descripcion', '')), '');
  v_categoria text := nullif(btrim(coalesce(v_datos ->> 'categoria', '')), '');
  v_proveedor text := nullif(lower(btrim(coalesce(v_datos ->> 'proveedor', ''))), '');
  v_puntos    integer;
  v_nivel     public.nivel;
  v_activa    boolean;
  v_id        uuid;
  v_anterior  public.recompensas%rowtype;
begin
  begin
    v_puntos := (v_datos ->> 'puntos')::integer;
    v_nivel  := coalesce(nullif(v_datos ->> 'nivel_minimo', ''), 'bronce')::public.nivel;
    v_activa := coalesce((v_datos ->> 'activa')::boolean, true);
  exception when others then
    raise exception 'dato_invalido: los puntos, el nivel o el estado no son válidos';
  end;
  if char_length(v_nombre) not between 3 and 120 then
    raise exception 'dato_invalido: el nombre debe tener entre 3 y 120 caracteres';
  end if;
  if v_puntos is null or v_puntos not between 1 and 100000 then
    raise exception 'dato_invalido: los puntos deben estar entre 1 y 100000';
  end if;
  if char_length(v_desc) > 1000 or char_length(v_categoria) > 40 then
    raise exception 'dato_invalido: la descripción o la categoría son demasiado largas';
  end if;
  if v_proveedor is not null and v_proveedor !~ '^[a-z0-9_-]{2,40}$' then
    raise exception 'dato_invalido: el proveedor solo admite minúsculas, números, guion y guion bajo';
  end if;

  if p_recompensa is null then
    if v_codigo !~ '^[a-z0-9][a-z0-9_-]{1,39}$' then
      raise exception 'dato_invalido: el código solo admite minúsculas, números, guion y guion bajo (2 a 40)';
    end if;
    if exists (select 1 from public.recompensas r where r.codigo = v_codigo) then
      raise exception 'estado_invalido: ya existe una recompensa con el código %', v_codigo;
    end if;
    insert into public.recompensas (codigo, nombre, descripcion, categoria, puntos, nivel_minimo, proveedor, activa)
    values (v_codigo, v_nombre, v_desc, v_categoria, v_puntos, v_nivel, v_proveedor, v_activa)
    returning id into v_id;
  else
    select * into v_anterior from public.recompensas r where r.id = p_recompensa for update;
    if not found then
      raise exception 'recompensa_inexistente: la recompensa no existe';
    end if;
    update public.recompensas r
    set nombre = v_nombre, descripcion = v_desc, categoria = v_categoria, puntos = v_puntos,
        nivel_minimo = v_nivel, proveedor = v_proveedor, activa = v_activa
    where r.id = p_recompensa;
    v_id := p_recompensa;
    v_codigo := v_anterior.codigo;
  end if;

  perform interno.registrar_accion_admin(p_admin, v_admin, 'guardar_recompensa', null, null, 'recompensa:' || v_codigo,
    jsonb_build_object('nueva', p_recompensa is null, 'nombre', v_nombre, 'puntos', v_puntos, 'nivel_minimo', v_nivel,
      'proveedor', v_proveedor, 'activa', v_activa,
      'antes', case when p_recompensa is null then null
                    else jsonb_build_object('nombre', v_anterior.nombre, 'puntos', v_anterior.puntos,
                           'nivel_minimo', v_anterior.nivel_minimo, 'proveedor', v_anterior.proveedor, 'activa', v_anterior.activa) end));
  return jsonb_build_object('recompensa_id', v_id, 'codigo', v_codigo, 'activa', v_activa);
end;
$$;

revoke execute on function interno.recompensas_codigo_inmutable() from public, anon, authenticated;
revoke execute on function interno.canjes_solo_anulacion() from public, anon, authenticated;
revoke execute on function public.registrar_canje(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.consultar_canjes(text, text) from public, anon, authenticated;
revoke execute on function public.admin_anular_canje(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_guardar_recompensa(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_canje(text, text, text, text) to service_role;
grant execute on function public.consultar_canjes(text, text) to service_role;
grant execute on function public.admin_anular_canje(uuid, uuid, text) to service_role;
grant execute on function public.admin_guardar_recompensa(uuid, uuid, jsonb) to service_role;

-- Las cuentas de admin no se sincronizan con Clientify (flujo A, decisión del equipo) -------------------------------

alter table public.aliados
  drop constraint aliados_clientify_sync_estado_check,
  add constraint aliados_clientify_sync_estado_check
    check (clientify_sync_estado in ('pendiente', 'ok', 'error', 'excluido'));

comment on column public.aliados.clientify_sync_estado is
  'pendiente | ok | error | excluido (cuenta de admin: no se envía a Clientify)';

-- Al volverse admin la cuenta queda excluida; si deja de serlo, vuelve a la cola del flujo A.
create function interno.aliados_exclusion_clientify()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rol = 'admin' then
    new.clientify_sync_estado := 'excluido';
    new.clientify_sync_error := null;
    new.clientify_sync_proximo_at := null;
  elsif new.clientify_sync_estado = 'excluido' then
    new.clientify_sync_estado := 'pendiente';
    new.clientify_sync_intentos := 0;
    new.clientify_sync_proximo_at := null;
  end if;
  return new;
end;
$$;

create trigger aliados_exclusion_clientify
  before insert or update of rol, clientify_sync_estado on public.aliados
  for each row execute function interno.aliados_exclusion_clientify();

revoke execute on function interno.aliados_exclusion_clientify() from public, anon, authenticated;

update public.aliados a set clientify_sync_estado = 'excluido', clientify_sync_error = null, clientify_sync_proximo_at = null
where a.rol = 'admin' and a.clientify_sync_estado <> 'excluido';

-- Respaldo: la cola del flujo A nunca reclama una cuenta de admin.
create or replace function public.clientify_reclamar_aliados(p_limite integer default 10)
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
      and a.rol <> 'admin'
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

-- Si un admin se volvió admin mientras su sincronización estaba en curso, el resultado no lo saca de 'excluido'.
create or replace function public.clientify_registrar_resultado(p_aliado uuid, p_contact_id text, p_error text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.aliados a where a.id = p_aliado and a.rol = 'admin') then
    return;
  end if;
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

-- Vistas ---------------------------------------------------------------------------------------------------------------
-- security_invoker; las de admin además exigen es_admin(). Ninguna expone aliados.id.

create view public.v_mis_canjes
with (security_invoker = true)
as
select c.id as canje_id, c.fecha, c.recompensa, r.codigo as recompensa_codigo, r.categoria, c.puntos, c.proveedor,
       c.estado, c.anulado_at, c.anulacion_motivo
from public.canjes c
left join public.recompensas r on r.id = c.recompensa_id
where c.aliado_id = (select auth.uid());

-- Catálogo activo con lo que le falta al aliado de la sesión para cada recompensa.
create view public.v_recompensas
with (security_invoker = true)
as
select r.codigo, r.nombre, r.descripcion, r.categoria, r.puntos, r.nivel_minimo,
       (a.estado = 'activo' and a.nivel >= r.nivel_minimo and a.puntos_disponibles >= r.puntos) as disponible,
       a.nivel < r.nivel_minimo as falta_nivel,
       greatest(r.puntos - a.puntos_disponibles, 0) as puntos_faltantes
from public.recompensas r
join public.aliados a on a.id = (select auth.uid())
where r.activa;

create view public.v_admin_canjes
with (security_invoker = true)
as
select c.id as canje_id, c.fecha, a.codigo_aliado, a.nombre_completo, a.tipo_aliado, c.recompensa, r.codigo as recompensa_codigo,
       c.puntos, c.nivel_requerido, c.proveedor, c.referencia_externa, c.estado, c.anulado_at,
       an.codigo_aliado as anulado_por, c.anulacion_motivo
from public.canjes c
join public.aliados a on a.id = c.aliado_id
left join public.recompensas r on r.id = c.recompensa_id
left join public.aliados an on an.id = c.anulado_por
where (select interno.es_admin());

create view public.v_admin_recompensas
with (security_invoker = true)
as
select r.id as recompensa_id, r.codigo, r.nombre, r.descripcion, r.categoria, r.puntos, r.nivel_minimo, r.proveedor,
       r.activa, r.created_at, r.updated_at,
       coalesce(k.canjes, 0)::integer as canjes_confirmados,
       coalesce(k.puntos, 0)::integer as puntos_redimidos
from public.recompensas r
left join lateral (
  select count(*) as canjes, sum(c.puntos) as puntos
  from public.canjes c where c.recompensa_id = r.id and c.estado = 'confirmado'
) k on true
where (select interno.es_admin());

-- Resumen del panel: se agregan los canjes del mes (columnas al final para conservar las existentes).
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
  (select count(*) from public.recompensas r where r.activa)::integer                                as recompensas_activas
where (select interno.es_admin());

revoke all on public.v_mis_canjes, public.v_recompensas, public.v_admin_canjes, public.v_admin_recompensas
  from public, anon, authenticated;
grant select on public.v_mis_canjes, public.v_recompensas, public.v_admin_canjes, public.v_admin_recompensas
  to authenticated, service_role;
