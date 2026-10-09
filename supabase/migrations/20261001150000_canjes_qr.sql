-- Fase 11 · 01 — Canje de Puntos Sol con código QR (CLAUDE.md §4.10, §10; decisiones de la fase 11).
--
-- El aliado muestra en el Hub un QR que cambia solo: cada QR lleva una "ficha" aleatoria que firma la base, vale
-- 5 minutos, sirve una sola vez y queda anulada en cuanto el Hub genera la siguiente (cada 60 s). En la base solo
-- se guarda la huella (sha256) de la ficha. El QR es un enlace a /canje.html#q=<ficha>: lo que va después del '#'
-- no viaja a ningún servidor. Debajo del QR hay un código corto de 8 caracteres por si la cámara falla.
--
-- Escanea un "operador" (personal de GEENERA o del proveedor) o un admin. Los operadores NO son aliados: los invita un
-- admin desde el panel y quedan ligados a un proveedor (los admins canjean como 'geenera'). Las reglas del canje
-- (cuenta activa, recompensa del proveedor, nivel ≥ mínimo, saldo, 30 canjes por hora) son las mismas de
-- POST /api/canjes: las dos rutas usan interno.registrar_canje_base.
--
-- A diferencia del resto de funciones del Hub, las del QR las llama el navegador con la sesión del usuario
-- (SECURITY DEFINER + auth.uid()), para no gastar funciones de Vercel. Cada una verifica quién la llama.
--
-- Errores con prefijo estable: aliado_no_activo · aliado_inexistente · no_autorizado · limite_qr · limite_intentos
--   propio_qr · dato_invalido · estado_invalido · operador_inexistente (y los del canje: recompensa_inexistente,
--   nivel_insuficiente, saldo_insuficiente, limite_canjes, referencia_duplicada).
-- Un QR que no existe, venció, ya se usó o fue reemplazado no es un error: la función responde { ok: false, codigo }
-- (qr_invalido · qr_vencido · qr_usado · qr_reemplazado) para que el intento fallido quede contado.

-- Operadores ---------------------------------------------------------------------------------------------------------

create table public.operadores (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid unique references auth.users (id) on delete set null,   -- se completa al crear la cuenta
  correo        text not null check (correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(correo) <= 254),
  nombre        text not null check (char_length(btrim(nombre)) between 3 and 120),
  proveedor     text not null check (proveedor ~ '^[a-z0-9_-]{2,40}$'),
  activo        boolean not null default true,
  invitado_por  uuid references public.aliados (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.operadores is
  'Personas que registran canjes escaneando el QR del aliado (canje.html). No son aliados; los invita un admin.';

create unique index operadores_correo_key on public.operadores (lower(correo));
create index operadores_invitado_por_idx on public.operadores (invitado_por) where invitado_por is not null;

create trigger operadores_updated_at
  before update on public.operadores
  for each row execute function interno.set_updated_at();

alter table public.operadores enable row level security;
revoke all on table public.operadores from anon, authenticated;
grant all on table public.operadores to service_role;
grant select on table public.operadores to authenticated;
-- El operador ve su propia fila; un admin ve todas.
create policy operadores_select on public.operadores
  for select to authenticated
  using (usuario_id = (select auth.uid()) or (select interno.es_admin()));

-- Fichas de QR -------------------------------------------------------------------------------------------------------

create table public.canjes_qr (
  id            uuid primary key default gen_random_uuid(),
  aliado_id     uuid not null references public.aliados (id) on delete cascade,
  ficha_hash    bytea not null unique,                               -- sha256 de la ficha; la ficha no se guarda
  codigo_corto  text not null check (codigo_corto ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  creado_at     timestamptz not null default now(),
  vence_at      timestamptz not null,
  usado_at      timestamptz,
  anulado_at    timestamptz,                                         -- reemplazado por un QR más nuevo
  canje_id      uuid references public.canjes (id) on delete set null
);

comment on table public.canjes_qr is
  'Fichas de los QR de canje: 5 minutos, un solo uso; el QR nuevo anula el anterior. Solo se escribe con funciones.';

create index canjes_qr_aliado_idx on public.canjes_qr (aliado_id, creado_at desc);
create index canjes_qr_codigo_idx on public.canjes_qr (codigo_corto, creado_at desc);
create index canjes_qr_canje_idx on public.canjes_qr (canje_id) where canje_id is not null;

alter table public.canjes_qr enable row level security;
revoke all on table public.canjes_qr from anon, authenticated;
grant all on table public.canjes_qr to service_role;

-- Consultas de QR que no existían (para frenar a quien pruebe códigos al azar).
create table public.canjes_qr_intentos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references auth.users (id) on delete cascade,
  creado_at   timestamptz not null default now()
);

create index canjes_qr_intentos_usuario_idx on public.canjes_qr_intentos (usuario_id, creado_at desc);

alter table public.canjes_qr_intentos enable row level security;
revoke all on table public.canjes_qr_intentos from anon, authenticated;
grant all on table public.canjes_qr_intentos to service_role;

-- Canjes: quién lo registró y por qué ruta ----------------------------------------------------------------------------

alter table public.canjes
  add column origen          text not null default 'api' check (origen in ('api', 'qr')),
  add column registrado_por  uuid references auth.users (id) on delete set null;   -- operador o admin (solo QR)

create index canjes_registrado_por_idx on public.canjes (registrado_por, fecha desc) where registrado_por is not null;

-- Un canje sigue sin editarse; origen y registrado_por tampoco cambian (registrado_por solo puede quedar en NULL
-- si se borra la cuenta de quien lo registró).
create or replace function interno.canjes_solo_anulacion()
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
      new.fecha, new.recompensa_id, new.origen)
     is distinct from
     (old.id, old.aliado_id, old.puntos, old.recompensa, old.nivel_requerido, old.proveedor, old.referencia_externa,
      old.fecha, old.recompensa_id, old.origen)
     or (new.registrado_por is not null and new.registrado_por is distinct from old.registrado_por) then
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

alter table public.movimientos_puntos
  drop constraint movimientos_puntos_creado_por_check,
  add constraint movimientos_puntos_creado_por_check check (
    creado_por in ('sistema', 'webhook_clientify', 'canjes_api', 'canjes_qr')
    or creado_por ~ '^admin:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

alter table public.acciones_admin
  drop constraint acciones_admin_accion_check,
  add constraint acciones_admin_accion_check check (accion in (
    'aprobar_aliado', 'rechazar_aliado', 'suspender_aliado', 'reactivar_aliado',
    'ajuste_puntos', 'baja_calidad', 'validar_evento', 'rechazar_evento', 'resolver_conflicto',
    'anular_canje', 'guardar_recompensa', 'invitar_operador', 'estado_operador'));

-- Lógica de canje compartida (API y QR) --------------------------------------------------------------------------------

-- Recompensas que un proveedor puede ofrecerle a un aliado, con si están disponibles y por qué no.
create function interno.recompensas_para(p_aliado public.aliados, p_proveedor text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', r.codigo, 'nombre', r.nombre, 'descripcion', r.descripcion, 'categoria', r.categoria,
           'puntos', r.puntos, 'nivel_minimo', r.nivel_minimo,
           'disponible', p_aliado.estado = 'activo' and p_aliado.nivel >= r.nivel_minimo and p_aliado.puntos_disponibles >= r.puntos,
           'motivo', case when p_aliado.estado <> 'activo' then 'aliado_no_activo'
                          when p_aliado.nivel < r.nivel_minimo then 'nivel_insuficiente'
                          when p_aliado.puntos_disponibles < r.puntos then 'saldo_insuficiente' end)
         order by r.puntos, r.nombre), '[]'::jsonb)
  from public.recompensas r
  where r.activa and (r.proveedor is null or r.proveedor = p_proveedor);
$$;

-- Registra un canje (fase 10) con quién lo registró y por qué ruta. Idempotente por (proveedor, referencia).
create function interno.registrar_canje_base(p_proveedor text, p_codigo text, p_recompensa text, p_referencia text,
                                             p_registrado_por uuid, p_origen text)
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
    insert into public.canjes (aliado_id, puntos, recompensa, nivel_requerido, proveedor, referencia_externa, recompensa_id,
                               origen, registrado_por)
    values (v_aliado.id, v_recompensa.puntos, v_recompensa.nombre, v_recompensa.nivel_minimo, v_proveedor, v_referencia,
            v_recompensa.id, p_origen, p_registrado_por)
    returning id into v_canje;
  exception when unique_violation then
    -- Otro canje con la misma referencia (de otro aliado) se registró al mismo tiempo.
    raise exception 'referencia_duplicada: la referencia % ya se usó en otro canje', v_referencia;
  end;

  -- El trigger del libro mayor vuelve a validar el saldo (saldo_insuficiente) y recalcula la caché del aliado.
  insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, vinculo_id, clave_unica, creado_por, nota)
  values (v_aliado.id, 'redimido', v_recompensa.puntos, 'canje', 'canjes', v_canje::text, 'canje:' || v_canje,
          case p_origen when 'qr' then 'canjes_qr' else 'canjes_api' end, v_recompensa.nombre);

  select * into v_final from public.aliados a where a.id = v_aliado.id;
  return jsonb_build_object('canje_id', v_canje, 'codigo_aliado', v_final.codigo_aliado, 'recompensa', v_recompensa.nombre,
    'puntos', v_recompensa.puntos, 'estado', 'confirmado', 'puntos_disponibles', v_final.puntos_disponibles,
    'nivel', v_final.nivel, 'duplicado', false);
end;
$$;

-- POST /api/canjes sigue igual por fuera: misma firma y mismas respuestas.
create or replace function public.registrar_canje(p_proveedor text, p_codigo text, p_recompensa text, p_referencia text)
returns jsonb
language sql
set search_path = ''
as $$
  select interno.registrar_canje_base(p_proveedor, p_codigo, p_recompensa, p_referencia, null, 'api');
$$;

create or replace function public.consultar_canjes(p_proveedor text, p_codigo text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_proveedor text := lower(btrim(coalesce(p_proveedor, '')));
  v_aliado    public.aliados%rowtype;
begin
  select * into v_aliado from public.aliados a where a.codigo_aliado = upper(btrim(coalesce(p_codigo, '')));
  if not found then
    raise exception 'aliado_inexistente: no existe un aliado con ese código';
  end if;
  return jsonb_build_object(
    'codigo_aliado', v_aliado.codigo_aliado,
    'activo', v_aliado.estado = 'activo',
    'nivel', v_aliado.nivel,
    'puntos_disponibles', v_aliado.puntos_disponibles,
    'recompensas', interno.recompensas_para(v_aliado, v_proveedor));
end;
$$;

-- Utilidades del QR ------------------------------------------------------------------------------------------------------

-- Operador (o admin) de la sesión: usuario y proveedor con el que canjea. Falla si no puede escanear.
create function interno.operador_de_sesion()
returns table (usuario_id uuid, proveedor text, nombre text, es_admin boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is not null then
    return query
      select o.usuario_id, o.proveedor, o.nombre, false from public.operadores o where o.usuario_id = v_uid and o.activo
      union all
      select a.id, 'geenera'::text, a.nombre_completo, true from public.aliados a
      where a.id = v_uid and a.rol = 'admin' and a.estado = 'activo'
      limit 1;
    if found then
      return;
    end if;
  end if;
  raise exception 'no_autorizado: esta cuenta no puede registrar canjes';
end;
$$;

-- "Juan José Pérez" → "Juan J.": lo justo para que el operador confirme a quién atiende.
create function interno.nombre_corto(p_nombre text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when array_length(p, 1) > 1 then p[1] || ' ' || upper(left(p[2], 1)) || '.' else p[1] end
  from (select regexp_split_to_array(btrim(coalesce(p_nombre, '')), '\s+') as p) x;
$$;

-- "k7m2-qx9t" → "K7M2QX9T"; NULL si no tiene la forma de un código corto.
create function interno.normalizar_codigo_qr(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when v ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' then v end
  from (select upper(regexp_replace(coalesce(p_texto, ''), '[\s-]', '', 'g')) as v) x;
$$;

-- Busca la ficha por la ficha completa (lo que trae el QR) o por el código corto (lo que se escribe a mano).
-- Con p_bloquear la toma con FOR UPDATE. Devuelve NULL si no existe.
create function interno.buscar_qr(p_qr text, p_bloquear boolean)
returns public.canjes_qr
language plpgsql
set search_path = ''
as $$
declare
  v_texto  text := btrim(coalesce(p_qr, ''));
  v_codigo text := interno.normalizar_codigo_qr(v_texto);
  v_qr     public.canjes_qr%rowtype;
begin
  if v_codigo is not null then
    -- El código corto identifica el QR más reciente con ese código de la última hora (vigente, usado o reemplazado).
    if p_bloquear then
      select * into v_qr from public.canjes_qr q
      where q.codigo_corto = v_codigo and q.vence_at > now() - interval '1 hour'
      order by q.creado_at desc limit 1 for update;
    else
      select * into v_qr from public.canjes_qr q
      where q.codigo_corto = v_codigo and q.vence_at > now() - interval '1 hour'
      order by q.creado_at desc limit 1;
    end if;
  elsif v_texto ~ '^[A-Za-z0-9_-]{40,64}$' then
    if p_bloquear then
      select * into v_qr from public.canjes_qr q
      where q.ficha_hash = extensions.digest(v_texto, 'sha256') for update;
    else
      select * into v_qr from public.canjes_qr q where q.ficha_hash = extensions.digest(v_texto, 'sha256');
    end if;
  end if;
  if v_qr.id is null then
    return null;
  end if;
  return v_qr;
end;
$$;

-- Estado de una ficha para el operador: NULL si se puede canjear, o el código de por qué no.
create function interno.estado_qr(p_qr public.canjes_qr)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_qr.usado_at is not null then 'qr_usado'
              when p_qr.anulado_at is not null then 'qr_reemplazado'
              when p_qr.vence_at <= now() then 'qr_vencido' end;
$$;

-- Cuenta un intento fallido del operador y falla si ya acumula 20 en 10 minutos.
create function interno.contar_intento_qr(p_usuario uuid, p_registrar boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.canjes_qr_intentos i
      where i.usuario_id = p_usuario and i.creado_at > now() - interval '10 minutes') >= 20 then
    raise exception 'limite_intentos: demasiados códigos inválidos; espera unos minutos';
  end if;
  if p_registrar then
    insert into public.canjes_qr_intentos (usuario_id) values (p_usuario);
  end if;
end;
$$;

-- Funciones del aliado (Hub) ---------------------------------------------------------------------------------------------

-- Genera el QR del aliado de la sesión y anula los anteriores que no se usaron. Máximo 30 cada 10 minutos.
-- Devuelve la ficha (solo esta vez: la base guarda su huella), el código corto y cuántos segundos le quedan.
create function public.generar_qr_canje()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aliado public.aliados%rowtype;
  v_ficha  text;
  v_codigo text;
  v_bytes  bytea;
  v_qr     public.canjes_qr%rowtype;
  v_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  -- Sin FOR UPDATE: canjear_qr bloquea la ficha y luego al aliado; aquí solo se bloquean fichas (no hay cruce).
  select * into v_aliado from public.aliados a where a.id = (select auth.uid());
  if not found then
    raise exception 'aliado_inexistente: esta cuenta no es de un aliado';
  end if;
  if v_aliado.estado <> 'activo' then
    raise exception 'aliado_no_activo: la cuenta no está activa';
  end if;
  if (select count(*) from public.canjes_qr q where q.aliado_id = v_aliado.id and q.creado_at > now() - interval '10 minutes') >= 30 then
    raise exception 'limite_qr: generaste demasiados QR; espera unos minutos';
  end if;

  update public.canjes_qr q set anulado_at = now()
  where q.aliado_id = v_aliado.id and q.usado_at is null and q.anulado_at is null;

  v_ficha := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_codigo := '';
    for i in 0..7 loop
      v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % length(v_alfabeto)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.canjes_qr q
                          where q.codigo_corto = v_codigo and q.vence_at > now() - interval '1 hour');
  end loop;

  insert into public.canjes_qr (aliado_id, ficha_hash, codigo_corto, vence_at)
  values (v_aliado.id, extensions.digest(v_ficha, 'sha256'), v_codigo, now() + interval '5 minutes')
  returning * into v_qr;

  return jsonb_build_object('ficha', v_ficha, 'codigo_corto', v_qr.codigo_corto, 'vence_at', v_qr.vence_at,
    'vence_en', 300, 'codigo_aliado', v_aliado.codigo_aliado, 'puntos_disponibles', v_aliado.puntos_disponibles,
    'nivel', v_aliado.nivel);
end;
$$;

-- Estado del QR que el aliado está mostrando (lo consulta el Hub cada pocos segundos).
create function public.estado_qr_canje(p_codigo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_qr    public.canjes_qr%rowtype;
  v_canje public.canjes%rowtype;
  v_saldo integer;
begin
  select * into v_qr from public.canjes_qr q
  where q.aliado_id = (select auth.uid()) and q.codigo_corto = interno.normalizar_codigo_qr(p_codigo)
  order by q.creado_at desc limit 1;
  if not found then
    return jsonb_build_object('estado', 'inexistente');
  end if;
  if v_qr.usado_at is not null then
    select * into v_canje from public.canjes c where c.id = v_qr.canje_id;
    select a.puntos_disponibles into v_saldo from public.aliados a where a.id = v_qr.aliado_id;
    return jsonb_build_object('estado', 'usado', 'usado_at', v_qr.usado_at, 'recompensa', v_canje.recompensa,
      'puntos', v_canje.puntos, 'puntos_disponibles', v_saldo);
  end if;
  return jsonb_build_object('estado', case when v_qr.anulado_at is not null then 'reemplazado'
                                           when v_qr.vence_at <= now() then 'vencido' else 'vigente' end,
    'vence_at', v_qr.vence_at);
end;
$$;

-- Funciones del operador (canje.html) ---------------------------------------------------------------------------------

-- Quién es el operador de la sesión (para la cabecera de canje.html).
create function public.perfil_operador()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_op record;
begin
  select * into v_op from interno.operador_de_sesion();
  return jsonb_build_object('nombre', v_op.nombre, 'proveedor', v_op.proveedor, 'es_admin', v_op.es_admin);
end;
$$;

-- Lo que ve el operador al escanear: el aliado (código, nombre corto, nivel, saldo) y las recompensas de su proveedor.
create function public.consultar_qr_canje(p_qr text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op     record;
  v_qr     public.canjes_qr%rowtype;
  v_aliado public.aliados%rowtype;
  v_estado text;
begin
  select * into v_op from interno.operador_de_sesion();
  perform interno.contar_intento_qr(v_op.usuario_id, false);

  v_qr := interno.buscar_qr(p_qr, false);
  if v_qr.id is null then
    perform interno.contar_intento_qr(v_op.usuario_id, true);
    return jsonb_build_object('ok', false, 'codigo', 'qr_invalido');
  end if;
  v_estado := interno.estado_qr(v_qr);
  if v_estado is not null then
    return jsonb_build_object('ok', false, 'codigo', v_estado);
  end if;
  if v_qr.aliado_id = v_op.usuario_id then
    raise exception 'propio_qr: no puedes registrar un canje con tu propio QR';
  end if;

  select * into v_aliado from public.aliados a where a.id = v_qr.aliado_id;
  return jsonb_build_object('ok', true,
    'aliado', jsonb_build_object('codigo_aliado', v_aliado.codigo_aliado, 'nombre', interno.nombre_corto(v_aliado.nombre_completo),
      'nivel', v_aliado.nivel, 'puntos_disponibles', v_aliado.puntos_disponibles, 'activo', v_aliado.estado = 'activo'),
    'vence_en', greatest(0, ceil(extract(epoch from v_qr.vence_at - now())))::integer,
    'recompensas', interno.recompensas_para(v_aliado, v_op.proveedor));
end;
$$;

-- Registra el canje del QR con la recompensa elegida y "quema" la ficha. Un doble toque devuelve el mismo canje.
create function public.canjear_qr(p_qr text, p_recompensa text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op        record;
  v_qr        public.canjes_qr%rowtype;
  v_estado    text;
  v_codigo    text;
  v_resultado jsonb;
  v_canje     public.canjes%rowtype;
  v_saldo     integer;
begin
  select * into v_op from interno.operador_de_sesion();
  perform interno.contar_intento_qr(v_op.usuario_id, false);

  v_qr := interno.buscar_qr(p_qr, true);
  if v_qr.id is null then
    perform interno.contar_intento_qr(v_op.usuario_id, true);
    return jsonb_build_object('ok', false, 'codigo', 'qr_invalido');
  end if;

  v_estado := interno.estado_qr(v_qr);
  if v_estado = 'qr_usado' then
    -- El mismo operador confirmó dos veces la misma recompensa: se responde con el canje original.
    select * into v_canje from public.canjes c where c.id = v_qr.canje_id;
    if v_canje.registrado_por = v_op.usuario_id
       and v_canje.recompensa_id = (select r.id from public.recompensas r where r.codigo = lower(btrim(coalesce(p_recompensa, '')))) then
      select a.puntos_disponibles into v_saldo from public.aliados a where a.id = v_canje.aliado_id;
      return jsonb_build_object('ok', true, 'duplicado', true, 'canje_id', v_canje.id, 'recompensa', v_canje.recompensa,
        'puntos', v_canje.puntos, 'estado', v_canje.estado, 'puntos_disponibles', v_saldo,
        'codigo_aliado', (select a.codigo_aliado from public.aliados a where a.id = v_canje.aliado_id));
    end if;
  end if;
  if v_estado is not null then
    return jsonb_build_object('ok', false, 'codigo', v_estado);
  end if;
  if v_qr.aliado_id = v_op.usuario_id then
    raise exception 'propio_qr: no puedes registrar un canje con tu propio QR';
  end if;

  select a.codigo_aliado into v_codigo from public.aliados a where a.id = v_qr.aliado_id;
  v_resultado := interno.registrar_canje_base(v_op.proveedor, v_codigo, p_recompensa, 'qr:' || v_qr.id, v_op.usuario_id, 'qr');

  update public.canjes_qr q set usado_at = now(), canje_id = (v_resultado ->> 'canje_id')::uuid where q.id = v_qr.id;
  return v_resultado || jsonb_build_object('ok', true);
end;
$$;

-- Canjes que registró el operador de la sesión hoy (hora Bogotá), para cuadrar la jornada.
create function public.mis_canjes_registrados()
returns table (fecha timestamptz, codigo_aliado text, recompensa text, puntos integer, estado text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.fecha, a.codigo_aliado, c.recompensa, c.puntos, c.estado
  from public.canjes c
  join public.aliados a on a.id = c.aliado_id
  where c.registrado_por = (select auth.uid())
    and c.fecha >= date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota'
  order by c.fecha desc;
$$;

-- Panel: operadores ---------------------------------------------------------------------------------------------------------

-- Invita (o vuelve a invitar) a un operador. SECURITY DEFINER solo para buscar si el correo ya tiene cuenta en Auth.
-- Devuelve `cuenta`: 'nueva' (POST /api/admin genera el enlace de invitación), 'operador' (cuenta de operador que
-- aún no puso contraseña: se genera un enlace para crearla) o 'aliado' (ya entra con su contraseña del Hub; no hay enlace).
create function public.admin_invitar_operador(p_admin uuid, p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin     text := interno.exigir_admin(p_admin);
  v_datos     jsonb := coalesce(p_datos, '{}'::jsonb);
  v_correo    text := lower(btrim(coalesce(v_datos ->> 'correo', '')));
  v_nombre    text := btrim(coalesce(v_datos ->> 'nombre', ''));
  v_proveedor text := lower(btrim(coalesce(v_datos ->> 'proveedor', '')));
  v_usuario   uuid;
  v_op        public.operadores%rowtype;
  v_cuenta    text;
begin
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_correo) > 254 then
    raise exception 'dato_invalido: el correo no es válido';
  end if;
  if char_length(v_nombre) not between 3 and 120 then
    raise exception 'dato_invalido: el nombre debe tener entre 3 y 120 caracteres';
  end if;
  if v_proveedor !~ '^[a-z0-9_-]{2,40}$' then
    raise exception 'dato_invalido: el proveedor solo admite minúsculas, números, guion y guion bajo';
  end if;

  select u.id into v_usuario from auth.users u where lower(u.email) = v_correo;

  select * into v_op from public.operadores o where lower(o.correo) = v_correo for update;
  if found then
    if v_op.activo and v_op.usuario_id is not null
       and exists (select 1 from auth.users u where u.id = v_op.usuario_id and u.encrypted_password is not null and u.encrypted_password <> '') then
      raise exception 'estado_invalido: % ya es operador', v_correo;
    end if;
    update public.operadores o set nombre = v_nombre, proveedor = v_proveedor, activo = true,
      usuario_id = coalesce(o.usuario_id, v_usuario), invitado_por = p_admin
    where o.id = v_op.id returning * into v_op;
  else
    insert into public.operadores (usuario_id, correo, nombre, proveedor, invitado_por)
    values (v_usuario, v_correo, v_nombre, v_proveedor, p_admin)
    returning * into v_op;
  end if;

  v_cuenta := case when v_usuario is null then 'nueva'
                   when exists (select 1 from public.aliados a where a.id = v_usuario) then 'aliado'
                   else 'operador' end;

  perform interno.registrar_accion_admin(p_admin, v_admin, 'invitar_operador', null, null, 'operador:' || v_op.id,
    jsonb_build_object('correo', v_correo, 'nombre', v_nombre, 'proveedor', v_proveedor, 'cuenta', v_cuenta));
  return jsonb_build_object('operador_id', v_op.id, 'correo', v_correo, 'cuenta', v_cuenta);
end;
$$;

-- Desactiva o reactiva a un operador (con motivo al desactivar).
create function public.admin_estado_operador(p_admin uuid, p_operador uuid, p_activo boolean, p_motivo text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_motivo text;
  v_op     public.operadores%rowtype;
begin
  if p_activo is null then
    raise exception 'dato_invalido: indica si el operador queda activo';
  end if;
  if not p_activo then
    v_motivo := interno.texto_obligatorio(p_motivo, 'el motivo', 5);
  end if;
  select * into v_op from public.operadores o where o.id = p_operador for update;
  if not found then
    raise exception 'operador_inexistente: el operador no existe';
  end if;
  if v_op.activo = p_activo then
    raise exception 'estado_invalido: el operador ya está %', case when p_activo then 'activo' else 'inactivo' end;
  end if;
  update public.operadores o set activo = p_activo where o.id = p_operador;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'estado_operador', null, null, 'operador:' || p_operador,
    jsonb_build_object('correo', v_op.correo, 'activo', p_activo, 'motivo', v_motivo));
  return jsonb_build_object('operador_id', p_operador, 'activo', p_activo);
end;
$$;

-- Registro: una cuenta invitada como operador no crea un aliado ----------------------------------------------------------
-- La invitación solo la crea un admin (admin_invitar_operador); el navegador no puede marcarse como operador.

create function interno.vincular_operador(p_usuario uuid, p_correo text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.operadores o set usuario_id = p_usuario
  where lower(o.correo) = lower(btrim(coalesce(p_correo, ''))) and o.usuario_id is null;
  return found;
end;
$$;

create or replace function interno.handle_new_aliado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta         jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_nombre       text  := interno.meta_texto(v_meta, 'nombre_completo');
  v_celular      text  := interno.meta_texto(v_meta, 'celular');
  v_regional     text  := interno.meta_texto(v_meta, 'regional');
  v_tipo_texto   text  := interno.meta_texto(v_meta, 'tipo_aliado');
  v_organizacion text  := interno.meta_texto(v_meta, 'organizacion');
  v_cargo        text  := interno.meta_texto(v_meta, 'cargo');
  v_como_llega   text  := interno.meta_texto(v_meta, 'como_llega_empresas');
  v_tipo         public.tipo_aliado;
begin
  -- Fase 11: si un admin invitó este correo como operador, la cuenta es de operador y no de aliado.
  if interno.vincular_operador(new.id, new.email) then
    return new;
  end if;

  -- Validación en servidor (§3). Los mensajes llegan a los logs de Auth, no al navegador:
  -- el front valida lo mismo antes de enviar.
  if new.email is null or btrim(new.email) = '' then
    raise exception 'registro_invalido: el correo es obligatorio';
  end if;

  if v_nombre is null or length(v_nombre) > 150 then
    raise exception 'registro_invalido: nombre_completo es obligatorio (máximo 150 caracteres)';
  end if;

  -- Celular internacional en formato E.164; si es de Colombia, 10 dígitos que empiezan por 3.
  if v_celular is null
     or v_celular !~ '^\+[1-9][0-9]{6,14}$'
     or (v_celular like '+57%' and v_celular !~ '^\+573[0-9]{9}$') then
    raise exception 'registro_invalido: celular inválido';
  end if;

  if v_tipo_texto is null
     or v_tipo_texto not in (select unnest(enum_range(null::public.tipo_aliado))::text) then
    raise exception 'registro_invalido: tipo_aliado inválido';
  end if;
  v_tipo := v_tipo_texto::public.tipo_aliado;

  if interno.usa_perfil_organizacion(v_tipo) then
    if v_organizacion is null or v_cargo is null then
      raise exception 'registro_invalido: organizacion y cargo son obligatorios para %', v_tipo;
    end if;
  elsif v_como_llega is null then
    raise exception 'registro_invalido: como_llega_empresas es obligatorio para %', v_tipo;
  end if;

  -- Ley 1581: autorización explícita de tratamiento de datos y aceptación de los términos.
  if coalesce(v_meta ->> 'autorizacion_datos', '') <> 'true' then
    raise exception 'registro_invalido: falta la autorización de tratamiento de datos';
  end if;
  if coalesce(v_meta ->> 'acepta_terminos', '') <> 'true' then
    raise exception 'registro_invalido: falta la aceptación de los términos y condiciones';
  end if;

  -- `rol` y `estado` nunca se toman de los metadatos: todo registro nuevo es un aliado pendiente.
  insert into public.aliados (
    id, codigo_aliado, nombre_completo, correo, celular, regional, tipo_aliado,
    autorizacion_datos_at, terminos_aceptados_at, terminos_version, politica_datos_version, estado, rol
  ) values (
    new.id, public.generar_codigo_aliado(v_nombre, v_tipo), v_nombre, new.email, v_celular, v_regional, v_tipo,
    now(), now(), interno.version_terminos_vigente(), interno.version_politica_datos_vigente(), 'pendiente', 'aliado'
  );

  if interno.usa_perfil_organizacion(v_tipo) then
    insert into public.aliados_perfil_organizacion (aliado_id, organizacion, cargo)
    values (new.id, v_organizacion, v_cargo);
  else
    insert into public.aliados_perfil_alcance (aliado_id, como_llega_empresas)
    values (new.id, v_como_llega);
  end if;

  return new;
end;
$$;

-- Limpieza: fichas vencidas sin usar e intentos fallidos viejos (cron diario 00:40 Bogotá) -------------------------------

create function interno.depurar_canjes_qr()
returns void
language sql
set search_path = ''
as $$
  delete from public.canjes_qr q where q.usado_at is null and q.vence_at < now() - interval '7 days';
  delete from public.canjes_qr_intentos i where i.creado_at < now() - interval '1 day';
$$;

select cron.schedule('depurar-canjes-qr', '40 5 * * *', 'select interno.depurar_canjes_qr()');

-- Privilegios ---------------------------------------------------------------------------------------------------------------

revoke execute on function interno.recompensas_para(public.aliados, text) from public, anon, authenticated;
revoke execute on function interno.registrar_canje_base(text, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function interno.operador_de_sesion() from public, anon, authenticated;
revoke execute on function interno.nombre_corto(text) from public, anon, authenticated;
revoke execute on function interno.normalizar_codigo_qr(text) from public, anon, authenticated;
revoke execute on function interno.buscar_qr(text, boolean) from public, anon, authenticated;
revoke execute on function interno.estado_qr(public.canjes_qr) from public, anon, authenticated;
revoke execute on function interno.contar_intento_qr(uuid, boolean) from public, anon, authenticated;
revoke execute on function interno.vincular_operador(uuid, text) from public, anon, authenticated;
revoke execute on function interno.depurar_canjes_qr() from public, anon, authenticated;
revoke execute on function public.registrar_canje(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.consultar_canjes(text, text) from public, anon, authenticated;
grant execute on function public.registrar_canje(text, text, text, text) to service_role;
grant execute on function public.consultar_canjes(text, text) to service_role;

-- Las del QR las llama el navegador con su sesión (authenticated); cada una verifica quién llama.
revoke execute on function public.generar_qr_canje() from public, anon;
revoke execute on function public.estado_qr_canje(text) from public, anon;
revoke execute on function public.perfil_operador() from public, anon;
revoke execute on function public.consultar_qr_canje(text) from public, anon;
revoke execute on function public.canjear_qr(text, text) from public, anon;
revoke execute on function public.mis_canjes_registrados() from public, anon;
grant execute on function public.generar_qr_canje() to authenticated;
grant execute on function public.estado_qr_canje(text) to authenticated;
grant execute on function public.perfil_operador() to authenticated;
grant execute on function public.consultar_qr_canje(text) to authenticated;
grant execute on function public.canjear_qr(text, text) to authenticated;
grant execute on function public.mis_canjes_registrados() to authenticated;

revoke execute on function public.admin_invitar_operador(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_estado_operador(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_invitar_operador(uuid, jsonb) to service_role;
grant execute on function public.admin_estado_operador(uuid, uuid, boolean, text) to service_role;

-- Vistas ----------------------------------------------------------------------------------------------------------------------
-- Columnas nuevas al final para conservar las existentes. Ninguna expone aliados.id.

create or replace view public.v_mis_canjes
with (security_invoker = true)
as
select c.id as canje_id, c.fecha, c.recompensa, r.codigo as recompensa_codigo, r.categoria, c.puntos, c.proveedor,
       c.estado, c.anulado_at, c.anulacion_motivo, c.origen
from public.canjes c
left join public.recompensas r on r.id = c.recompensa_id
where c.aliado_id = (select auth.uid());

create or replace view public.v_admin_canjes
with (security_invoker = true)
as
select c.id as canje_id, c.fecha, a.codigo_aliado, a.nombre_completo, a.tipo_aliado, c.recompensa, r.codigo as recompensa_codigo,
       c.puntos, c.nivel_requerido, c.proveedor, c.referencia_externa, c.estado, c.anulado_at,
       an.codigo_aliado as anulado_por, c.anulacion_motivo,
       c.origen, coalesce(op.nombre, ra.codigo_aliado) as registrado_por
from public.canjes c
join public.aliados a on a.id = c.aliado_id
left join public.recompensas r on r.id = c.recompensa_id
left join public.aliados an on an.id = c.anulado_por
left join public.operadores op on op.usuario_id = c.registrado_por
left join public.aliados ra on ra.id = c.registrado_por
where (select interno.es_admin());

create view public.v_admin_operadores
with (security_invoker = true)
as
select o.id as operador_id, o.nombre, o.correo, o.proveedor, o.activo, o.usuario_id is not null as cuenta_creada,
       ia.codigo_aliado as invitado_por, o.created_at, o.updated_at,
       coalesce(k.canjes, 0)::integer as canjes_registrados, k.ultimo_canje
from public.operadores o
left join public.aliados ia on ia.id = o.invitado_por
left join lateral (
  select count(*) as canjes, max(c.fecha) as ultimo_canje
  from public.canjes c where o.usuario_id is not null and c.registrado_por = o.usuario_id and c.estado = 'confirmado'
) k on true
where (select interno.es_admin());

revoke all on public.v_admin_operadores from public, anon, authenticated;
grant select on public.v_admin_operadores to authenticated, service_role;
