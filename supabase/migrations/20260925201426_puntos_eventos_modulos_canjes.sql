-- Fase 1 · 04 — Libro mayor de puntos, eventos, módulos, canjes y auditoría de webhooks
-- (CLAUDE.md §4.7–4.11, §5).

create table public.movimientos_puntos (
  id                uuid primary key default gen_random_uuid(),
  aliado_id         uuid not null references public.aliados (id) on delete cascade,
  tipo              text not null check (tipo in ('ganado', 'perdido', 'redimido')),
  puntos            integer not null check (puntos > 0),            -- valor nominal de la regla
  puntos_aplicados  integer not null check (puntos_aplicados >= 0), -- lo que realmente movió el saldo (§5.4)
  motivo            text not null,
  vinculo           text not null check (vinculo in (
                      'empresas', 'eventos', 'modulos_completados', 'racha', 'canjes', 'ajuste_admin'
                    )),
  vinculo_id        text,
  clave_unica       text not null unique,                           -- idempotencia (§5.1)
  fecha             timestamptz not null default now(),
  creado_por        text not null check (
                      creado_por in ('sistema', 'webhook_clientify', 'canjes_api')
                      or creado_por ~ '^admin:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    ),
  nota              text,

  -- El motivo debe corresponder al tipo (códigos de §5; 'canje' para redenciones).
  constraint movimientos_puntos_motivo_tipo check (
    (tipo = 'ganado' and motivo in (
      'registro_valido', 'referido_perfecto', 'empresa_calificada', 'evaluacion_tecnica',
      'propuesta_comercial', 'negocio_cerrado', 'modulo_completado', 'evento_validado',
      'racha_solar', 'ajuste_admin'
    ))
    or (tipo = 'perdido' and motivo in (
      'referido_imperfecto', 'referido_no_calificado', 'fuera_perfil', 'informacion_falsa',
      'baja_calidad_reiterada', 'ajuste_admin'
    ))
    or (tipo = 'redimido' and motivo = 'canje')
  ),
  -- Solo una pérdida puede aplicarse parcialmente (piso en 0, §5.4).
  constraint movimientos_puntos_aplicados check (
    puntos_aplicados <= puntos and (tipo = 'perdido' or puntos_aplicados = puntos)
  )
);

create index movimientos_puntos_aliado_fecha_idx on public.movimientos_puntos (aliado_id, fecha desc);

-- Solo inserción: las correcciones se registran como un nuevo movimiento `ajuste_admin`.
-- Única excepción: el borrado en cascada cuando se elimina la cuenta del aliado (Ley 1581).
create function interno.movimientos_puntos_solo_insercion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.aliados a where a.id = old.aliado_id) then
    return old;
  end if;
  raise exception 'movimientos_puntos es solo inserción (% no permitido); registra un ajuste_admin', tg_op;
end;
$$;

create trigger movimientos_puntos_solo_insercion
  before update or delete on public.movimientos_puntos
  for each row execute function interno.movimientos_puntos_solo_insercion();

create function interno.movimientos_puntos_bloquear_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'movimientos_puntos es solo inserción (TRUNCATE no permitido)';
end;
$$;

create trigger movimientos_puntos_bloquear_truncate
  before truncate on public.movimientos_puntos
  for each statement execute function interno.movimientos_puntos_bloquear_truncate();

-- Eventos -------------------------------------------------------------------

create table public.eventos (
  id                       uuid primary key default gen_random_uuid(),
  aliado_id                uuid not null references public.aliados (id) on delete cascade,
  nombre_evento            text not null check (btrim(nombre_evento) <> ''),
  tipo_evento              text,  -- conferencia, taller, etc.
  fecha                    date not null,
  geenera_involucrada      boolean not null default false,
  registro_asistentes      boolean not null default false,
  registro_asistentes_path text,  -- archivo opcional en Storage
  empresas_perfil_count    integer not null default 0 check (empresas_perfil_count >= 0),
  estado                   text not null default 'pendiente'
                           check (estado in ('pendiente', 'validado', 'rechazado')),
  validado_por             uuid references public.aliados (id) on delete set null,
  validado_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint eventos_revision_registrada check (estado = 'pendiente' or validado_at is not null),
  -- §4.8: solo se valida un evento realizado, con GEENERA, registro de asistentes y ≥ 5 empresas.
  constraint eventos_condiciones_validacion check (
    estado <> 'validado' or (
      geenera_involucrada
      and registro_asistentes
      and empresas_perfil_count >= 5
      and fecha <= (validado_at at time zone 'America/Bogota')::date
    )
  )
);

create index eventos_aliado_id_idx on public.eventos (aliado_id, fecha desc);
create index eventos_validado_por_idx on public.eventos (validado_por) where validado_por is not null;
create index eventos_pendientes_idx on public.eventos (created_at) where estado = 'pendiente';

create trigger eventos_set_updated_at
  before update on public.eventos
  for each row execute function interno.set_updated_at();

-- Módulos -------------------------------------------------------------------

create table public.modulos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (btrim(nombre) <> ''),
  orden       integer not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger modulos_set_updated_at
  before update on public.modulos
  for each row execute function interno.set_updated_at();

create table public.modulos_completados (
  id                 uuid primary key default gen_random_uuid(),
  aliado_id          uuid not null references public.aliados (id) on delete cascade,
  modulo_id          uuid not null references public.modulos (id) on delete restrict,
  fecha_completado   timestamptz not null default now(),
  recompensa_estado  text not null default 'pendiente' check (recompensa_estado in ('pendiente', 'otorgada')),
  fecha_otorgada     timestamptz,

  constraint modulos_completados_aliado_modulo_key unique (aliado_id, modulo_id), -- se premia una sola vez
  constraint modulos_completados_fecha_otorgada check (
    (recompensa_estado = 'otorgada') = (fecha_otorgada is not null)
  )
);

create index modulos_completados_modulo_id_idx on public.modulos_completados (modulo_id);
-- Cola FIFO de recompensas pendientes (§5.3).
create index modulos_completados_pendientes_idx on public.modulos_completados (aliado_id, fecha_completado)
  where recompensa_estado = 'pendiente';

-- Canjes (los alimenta un sistema externo vía POST /api/canjes) --------------

create table public.canjes (
  id                  uuid primary key default gen_random_uuid(),
  aliado_id           uuid not null references public.aliados (id) on delete cascade,
  puntos              integer not null check (puntos > 0),
  recompensa          text not null,
  nivel_requerido     public.nivel,
  proveedor           text not null,
  referencia_externa  text not null unique, -- idempotencia del sistema externo
  fecha               timestamptz not null default now()
);

create index canjes_aliado_id_idx on public.canjes (aliado_id, fecha desc);

-- Auditoría de integración ----------------------------------------------------

create table public.webhook_eventos (
  id            uuid primary key default gen_random_uuid(),
  fuente        text not null default 'clientify' check (fuente in ('clientify')),
  payload       jsonb not null,
  recibido_at   timestamptz not null default now(),
  procesado_at  timestamptz,
  error         text
);

create index webhook_eventos_pendientes_idx on public.webhook_eventos (recibido_at)
  where procesado_at is null;
