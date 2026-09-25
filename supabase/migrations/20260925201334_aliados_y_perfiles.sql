-- Fase 1 · 02 — Aliados y perfiles 1:1 (CLAUDE.md §2, §3, §4.1–4.3).

create table public.aliados (
  id                     uuid primary key references auth.users (id) on delete cascade, -- NUNCA exponer
  codigo_aliado          text not null unique,                                          -- ID_aliado público
  nombre_completo        text not null check (btrim(nombre_completo) <> ''),
  correo                 text not null check (btrim(correo) <> ''),
  celular                text not null check (btrim(celular) <> ''),
  regional               text,
  tipo_aliado            public.tipo_aliado not null,
  -- Valores calculados (caché; la fuente de verdad es movimientos_puntos / avance_empresa)
  puntos_nivel           integer not null default 0 check (puntos_nivel >= 0),
  puntos_disponibles     integer not null default 0 check (puntos_disponibles >= 0),
  calidad_referidos      numeric(5,2) check (calidad_referidos between 0 and 100),
  nivel                  public.nivel not null default 'bronce',
  -- Racha Solar 4x4
  racha_semana_1         boolean not null default false,
  racha_semana_2         boolean not null default false,
  racha_semana_3         boolean not null default false,
  racha_semana_4         boolean not null default false,
  racha_ultima_semana    date check (extract(isodow from racha_ultima_semana) = 1), -- siempre un lunes
  -- Integración y cumplimiento
  clientify_contact_id   text,
  clientify_sync_estado  text not null default 'pendiente'
                         check (clientify_sync_estado in ('pendiente', 'ok', 'error')),
  clientify_sync_error   text,
  autorizacion_datos_at  timestamptz not null,
  estado                 text not null default 'activo' check (estado in ('activo', 'suspendido')),
  rol                    text not null default 'aliado' check (rol in ('aliado', 'admin')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- PREFIJO_TIPO (2) + INICIALES (1–4) + ALEATORIO (8), ver §2
  constraint aliados_codigo_aliado_formato check (
    codigo_aliado ~ '^(FI|EM|LK|CE|AG)[A-Z]{1,4}[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'
  )
);

comment on column public.aliados.id is 'Igual a auth.users.id. Llave técnica: nunca se muestra ni se envía a sistemas externos.';
comment on column public.aliados.codigo_aliado is 'Identificador público e inmutable; se escribe en el campo ID_aliado de Clientify.';

create unique index aliados_correo_key on public.aliados (lower(correo));
create unique index aliados_clientify_contact_id_key on public.aliados (clientify_contact_id)
  where clientify_contact_id is not null;

create trigger aliados_set_updated_at
  before update on public.aliados
  for each row execute function interno.set_updated_at();

-- `id` y `codigo_aliado` son inmutables (§2, regla 5).
create function interno.aliados_proteger_inmutables()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'aliados.id es inmutable';
  end if;
  if new.codigo_aliado is distinct from old.codigo_aliado then
    raise exception 'aliados.codigo_aliado es inmutable';
  end if;
  return new;
end;
$$;

create trigger aliados_proteger_inmutables
  before update on public.aliados
  for each row execute function interno.aliados_proteger_inmutables();

-- Perfiles 1:1 según el tipo de aliado --------------------------------------

create table public.aliados_perfil_organizacion (
  aliado_id    uuid primary key references public.aliados (id) on delete cascade,
  organizacion text not null check (btrim(organizacion) <> ''),
  cargo        text not null check (btrim(cargo) <> ''),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.aliados_perfil_alcance (
  aliado_id           uuid primary key references public.aliados (id) on delete cascade,
  como_llega_empresas text not null check (btrim(como_llega_empresas) <> ''),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger aliados_perfil_organizacion_set_updated_at
  before update on public.aliados_perfil_organizacion
  for each row execute function interno.set_updated_at();

create trigger aliados_perfil_alcance_set_updated_at
  before update on public.aliados_perfil_alcance
  for each row execute function interno.set_updated_at();

-- Financieros y Agremiaciones usan el perfil de organización; el resto, el de alcance.
create function interno.usa_perfil_organizacion(tipo public.tipo_aliado)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select tipo in ('financiero', 'agremiaciones');
$$;

create function interno.validar_perfil_aliado()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tipo public.tipo_aliado;
begin
  select a.tipo_aliado into v_tipo from public.aliados a where a.id = new.aliado_id;

  if v_tipo is null then
    return new; -- la FK reporta el aliado inexistente
  end if;

  if tg_table_name = 'aliados_perfil_organizacion' and not interno.usa_perfil_organizacion(v_tipo) then
    raise exception 'El perfil de organización solo aplica a financiero y agremiaciones (tipo: %)', v_tipo;
  end if;

  if tg_table_name = 'aliados_perfil_alcance' and interno.usa_perfil_organizacion(v_tipo) then
    raise exception 'El perfil de alcance solo aplica a emi, linker y cliente_embajador (tipo: %)', v_tipo;
  end if;

  return new;
end;
$$;

create trigger aliados_perfil_organizacion_validar_tipo
  before insert or update of aliado_id on public.aliados_perfil_organizacion
  for each row execute function interno.validar_perfil_aliado();

create trigger aliados_perfil_alcance_validar_tipo
  before insert or update of aliado_id on public.aliados_perfil_alcance
  for each row execute function interno.validar_perfil_aliado();

-- Si cambia el tipo, no puede quedar un perfil del tipo contrario.
-- Para cambiar de tipo: borrar el perfil anterior, actualizar el tipo e insertar el nuevo perfil.
create function interno.validar_cambio_tipo_aliado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if interno.usa_perfil_organizacion(new.tipo_aliado)
     and exists (select 1 from public.aliados_perfil_alcance p where p.aliado_id = new.id) then
    raise exception 'El aliado tiene perfil de alcance y no puede pasar a tipo %', new.tipo_aliado;
  end if;

  if not interno.usa_perfil_organizacion(new.tipo_aliado)
     and exists (select 1 from public.aliados_perfil_organizacion p where p.aliado_id = new.id) then
    raise exception 'El aliado tiene perfil de organización y no puede pasar a tipo %', new.tipo_aliado;
  end if;

  return new;
end;
$$;

create trigger aliados_validar_cambio_tipo
  before update of tipo_aliado on public.aliados
  for each row
  when (new.tipo_aliado is distinct from old.tipo_aliado)
  execute function interno.validar_cambio_tipo_aliado();
