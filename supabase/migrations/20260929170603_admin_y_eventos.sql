-- Fase 9 · 01 — Panel de administración y eventos (CLAUDE.md §3, §4.8, §5, §5.1, §10).
--
-- Las acciones de admin las ejecuta POST /api/admin con SUPABASE_SECRET_KEY: cada función de este archivo
-- recibe el id del admin de la sesión, verifica que sea un admin activo y deja la acción en acciones_admin.
-- Los aliados se identifican por codigo_aliado (el panel nunca ve aliados.id, §2).
-- Los eventos los reporta el aliado desde el Hub (POST /api/eventos) y un admin los valida: +100 (§4.8).
--
-- Errores con prefijo estable, que los endpoints traducen a mensajes:
--   no_autorizado · aliado_inexistente · estado_invalido · no_permitido · dato_invalido · evento_inexistente
--   evento_incompleto · conflicto_inexistente · aliado_no_activo · limite_eventos · evento_invalido
--   evento_duplicado · archivo_invalido

-- Solicitud rechazada (decisión del equipo): no entra al Hub y queda el registro auditado ---------------------

alter table public.aliados
  drop constraint aliados_estado_check,
  add constraint aliados_estado_check check (estado in ('pendiente', 'activo', 'suspendido', 'rechazado'));

-- Auditoría de acciones de admin -----------------------------------------------------------------------------

create table public.acciones_admin (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid references public.aliados (id) on delete set null,
  admin_codigo  text not null,                                      -- se conserva aunque se borre la cuenta
  accion        text not null check (accion in (
                  'aprobar_aliado', 'rechazar_aliado', 'suspender_aliado', 'reactivar_aliado',
                  'ajuste_puntos', 'baja_calidad', 'validar_evento', 'rechazar_evento', 'resolver_conflicto')),
  aliado_id     uuid references public.aliados (id) on delete set null,
  aliado_codigo text,
  objetivo      text,                                               -- 'evento:{id}' | 'conflicto:{id}'
  detalle       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.acciones_admin is 'Auditoría de las acciones del panel de administración (solo inserción).';

create index acciones_admin_created_at_idx on public.acciones_admin (created_at desc);
create index acciones_admin_aliado_idx on public.acciones_admin (aliado_id) where aliado_id is not null;
create index acciones_admin_admin_idx on public.acciones_admin (admin_id) where admin_id is not null;

-- Solo inserción: se permite únicamente que el borrado de una cuenta (Ley 1581) anule sus referencias.
create function interno.acciones_admin_solo_insercion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.admin_id is null or new.admin_id = old.admin_id)
     and (new.aliado_id is null or new.aliado_id = old.aliado_id)
     and (new.id, new.admin_codigo, new.accion, new.aliado_codigo, new.objetivo, new.detalle, new.created_at)
         is not distinct from (old.id, old.admin_codigo, old.accion, old.aliado_codigo, old.objetivo, old.detalle, old.created_at) then
    return new;
  end if;
  raise exception 'acciones_admin es solo inserción (% no permitido)', tg_op;
end;
$$;

create trigger acciones_admin_solo_insercion
  before update or delete on public.acciones_admin
  for each row execute function interno.acciones_admin_solo_insercion();

alter table public.acciones_admin enable row level security;
revoke all on table public.acciones_admin from anon, authenticated;
grant all on table public.acciones_admin to service_role;
grant select on table public.acciones_admin to authenticated;
create policy acciones_admin_select on public.acciones_admin
  for select to authenticated
  using ((select interno.es_admin()));

-- Eventos: lo que reporta el aliado y la revisión del admin ----------------------------------------------------

alter table public.eventos
  add column descripcion    text check (char_length(descripcion) <= 1000),
  add column revision_nota  text check (char_length(revision_nota) <= 1000); -- nota del admin o motivo del rechazo

comment on column public.eventos.registro_asistentes_path is 'Archivo en el bucket privado eventos: {aliado_id}/{evento_id}/{archivo}.';

-- Bucket privado para el registro de asistentes. Sin políticas: el navegador sube con una URL firmada de un
-- solo uso (POST /api/eventos) y solo el servidor lee (el panel pide una URL firmada de corta duración).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('eventos', 'eventos', false, 10485760, array[
  'application/pdf', 'image/jpeg', 'image/png', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Utilidades internas -----------------------------------------------------------------------------------------

-- Devuelve el codigo_aliado del admin, o falla si p_admin no es un admin activo.
create function interno.exigir_admin(p_admin uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_codigo text;
begin
  select a.codigo_aliado into v_codigo
  from public.aliados a
  where a.id = p_admin and a.rol = 'admin' and a.estado = 'activo';
  if v_codigo is null then
    raise exception 'no_autorizado: se requiere una cuenta de administrador activa';
  end if;
  return v_codigo;
end;
$$;

-- Bloquea y devuelve el aliado por su código público.
create function interno.aliado_por_codigo(p_codigo text)
returns public.aliados
language plpgsql
set search_path = ''
as $$
declare
  v_aliado public.aliados%rowtype;
begin
  select * into v_aliado from public.aliados a where a.codigo_aliado = upper(btrim(coalesce(p_codigo, ''))) for update;
  if not found then
    raise exception 'aliado_inexistente: no existe un aliado con ese código';
  end if;
  return v_aliado;
end;
$$;

create function interno.registrar_accion_admin(
  p_admin uuid, p_admin_codigo text, p_accion text, p_aliado uuid, p_aliado_codigo text,
  p_objetivo text default null, p_detalle jsonb default '{}'::jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.acciones_admin (admin_id, admin_codigo, accion, aliado_id, aliado_codigo, objetivo, detalle)
  values (p_admin, p_admin_codigo, p_accion, p_aliado, p_aliado_codigo, p_objetivo, coalesce(p_detalle, '{}'::jsonb));
$$;

-- Texto obligatorio (motivo, justificación): recortado y con un mínimo de caracteres.
create function interno.texto_obligatorio(p_texto text, p_campo text, p_minimo integer default 5)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_texto, ''))) < p_minimo then
    raise exception 'dato_invalido: % debe tener al menos % caracteres', p_campo, p_minimo;
  end if;
  return left(btrim(p_texto), 1000);
end;
$$;

-- Movimiento de ajuste de admin (± puntos). Devuelve los puntos aplicados; null si la clave ya existía.
create function interno.insertar_ajuste(p_admin uuid, p_aliado uuid, p_puntos integer, p_nota text, p_clave uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_aplicados integer;
begin
  if p_puntos is null or p_puntos = 0 or abs(p_puntos) > 5000 then
    raise exception 'dato_invalido: el ajuste debe ser distinto de 0 y de máximo 5000 puntos';
  end if;
  if p_clave is null then
    raise exception 'dato_invalido: falta la clave del ajuste';
  end if;
  insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, clave_unica, creado_por, nota)
  values (p_aliado, case when p_puntos > 0 then 'ganado' else 'perdido' end, abs(p_puntos), 'ajuste_admin',
          'ajuste_admin', 'ajuste:' || p_clave, 'admin:' || p_admin, p_nota)
  on conflict (clave_unica) do nothing
  returning puntos_aplicados into v_aplicados;
  return v_aplicados;
end;
$$;

revoke execute on function interno.acciones_admin_solo_insercion() from public, anon, authenticated;
revoke execute on function interno.exigir_admin(uuid) from public, anon, authenticated;
revoke execute on function interno.aliado_por_codigo(text) from public, anon, authenticated;
revoke execute on function interno.registrar_accion_admin(uuid, text, text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function interno.texto_obligatorio(text, text, integer) from public, anon, authenticated;
revoke execute on function interno.insertar_ajuste(uuid, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function interno.exigir_admin(uuid) to service_role;
grant execute on function interno.aliado_por_codigo(text) to service_role;
grant execute on function interno.registrar_accion_admin(uuid, text, text, uuid, text, text, jsonb) to service_role;
grant execute on function interno.texto_obligatorio(text, text, integer) to service_role;
grant execute on function interno.insertar_ajuste(uuid, uuid, integer, text, uuid) to service_role;

-- Solicitudes y estado de los aliados (§3) ----------------------------------------------------------------------

-- Aprueba una solicitud pendiente (o reconsidera una rechazada). Al pasar a activo se disparan la
-- sincronización con Clientify (flujo A), la liberación de puntos retenidos y los módulos pendientes.
create function public.admin_aprobar_aliado(p_admin uuid, p_codigo text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_aliado public.aliados := interno.aliado_por_codigo(p_codigo);
begin
  if v_aliado.estado not in ('pendiente', 'rechazado') then
    raise exception 'estado_invalido: solo se aprueba una solicitud pendiente o rechazada (estado actual: %)', v_aliado.estado;
  end if;
  update public.aliados a set estado = 'activo', aprobado_at = now(), aprobado_por = p_admin where a.id = v_aliado.id;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'aprobar_aliado', v_aliado.id, v_aliado.codigo_aliado,
    null, jsonb_build_object('estado_anterior', v_aliado.estado));
  return jsonb_build_object('codigo_aliado', v_aliado.codigo_aliado, 'estado', 'activo');
end;
$$;

create function public.admin_rechazar_aliado(p_admin uuid, p_codigo text, p_motivo text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_motivo text := interno.texto_obligatorio(p_motivo, 'el motivo');
  v_aliado public.aliados := interno.aliado_por_codigo(p_codigo);
begin
  if v_aliado.estado <> 'pendiente' then
    raise exception 'estado_invalido: solo se rechaza una solicitud pendiente (estado actual: %)', v_aliado.estado;
  end if;
  update public.aliados a set estado = 'rechazado' where a.id = v_aliado.id;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'rechazar_aliado', v_aliado.id, v_aliado.codigo_aliado,
    null, jsonb_build_object('motivo', v_motivo));
  return jsonb_build_object('codigo_aliado', v_aliado.codigo_aliado, 'estado', 'rechazado');
end;
$$;

-- Un admin no puede suspenderse a sí mismo ni suspender a otro admin (evita dejar el programa sin administración).
create function public.admin_suspender_aliado(p_admin uuid, p_codigo text, p_motivo text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_motivo text := interno.texto_obligatorio(p_motivo, 'el motivo');
  v_aliado public.aliados := interno.aliado_por_codigo(p_codigo);
begin
  if v_aliado.rol = 'admin' then
    raise exception 'no_permitido: una cuenta de administrador no se suspende desde el panel';
  end if;
  if v_aliado.estado <> 'activo' then
    raise exception 'estado_invalido: solo se suspende una cuenta activa (estado actual: %)', v_aliado.estado;
  end if;
  update public.aliados a set estado = 'suspendido' where a.id = v_aliado.id;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'suspender_aliado', v_aliado.id, v_aliado.codigo_aliado,
    null, jsonb_build_object('motivo', v_motivo));
  return jsonb_build_object('codigo_aliado', v_aliado.codigo_aliado, 'estado', 'suspendido');
end;
$$;

-- Al reactivar, los puntos retenidos durante la suspensión se acreditan (§4.7).
create function public.admin_reactivar_aliado(p_admin uuid, p_codigo text, p_motivo text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_motivo text := interno.texto_obligatorio(p_motivo, 'el motivo');
  v_aliado public.aliados := interno.aliado_por_codigo(p_codigo);
begin
  if v_aliado.estado <> 'suspendido' then
    raise exception 'estado_invalido: solo se reactiva una cuenta suspendida (estado actual: %)', v_aliado.estado;
  end if;
  update public.aliados a set estado = 'activo' where a.id = v_aliado.id;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'reactivar_aliado', v_aliado.id, v_aliado.codigo_aliado,
    null, jsonb_build_object('motivo', v_motivo));
  return jsonb_build_object('codigo_aliado', v_aliado.codigo_aliado, 'estado', 'activo');
end;
$$;

-- Puntos (§5, §5.4) ----------------------------------------------------------------------------------------------

-- Ajuste manual justificado. p_clave la genera el panel por cada ajuste: un doble clic no lo duplica.
-- Se aplica aunque la cuenta no esté activa (§4.7) y un negativo respeta el piso en 0 (§5.4).
create function public.admin_ajuste_puntos(p_admin uuid, p_codigo text, p_puntos integer, p_nota text, p_clave uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin     text := interno.exigir_admin(p_admin);
  v_nota      text := interno.texto_obligatorio(p_nota, 'la justificación', 10);
  v_aliado    public.aliados := interno.aliado_por_codigo(p_codigo);
  v_aplicados integer := interno.insertar_ajuste(p_admin, v_aliado.id, p_puntos, v_nota, p_clave);
begin
  if v_aplicados is null then
    return jsonb_build_object('codigo_aliado', v_aliado.codigo_aliado, 'duplicado', true);
  end if;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'ajuste_puntos', v_aliado.id, v_aliado.codigo_aliado,
    'ajuste:' || p_clave, jsonb_build_object('puntos', p_puntos, 'aplicados', v_aplicados, 'nota', v_nota));
  return jsonb_build_object('codigo_aliado', v_aliado.codigo_aliado, 'puntos', p_puntos, 'puntos_aplicados', v_aplicados, 'duplicado', false);
end;
$$;

-- Baja calidad reiterada tras retroalimentación previa (−20). Máximo una por aliado y día (clave del §5).
create function public.admin_baja_calidad(p_admin uuid, p_codigo text, p_nota text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin    text := interno.exigir_admin(p_admin);
  v_nota     text := interno.texto_obligatorio(p_nota, 'la retroalimentación previa', 10);
  v_aliado   public.aliados := interno.aliado_por_codigo(p_codigo);
  v_clave    text := 'aliado:' || v_aliado.id || ':baja_calidad:' || (now() at time zone 'America/Bogota')::date;
  v_insertado integer;
begin
  insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, clave_unica, creado_por, nota)
  values (v_aliado.id, 'perdido', 'baja_calidad_reiterada', 'ajuste_admin', v_clave, 'admin:' || p_admin, v_nota)
  on conflict (clave_unica) do nothing;
  get diagnostics v_insertado = row_count;
  if v_insertado = 0 and not exists (select 1 from public.movimientos_retenidos r where r.clave_unica = v_clave) then
    raise exception 'estado_invalido: ya se registró una baja calidad reiterada para este aliado hoy';
  end if;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'baja_calidad', v_aliado.id, v_aliado.codigo_aliado,
    null, jsonb_build_object('nota', v_nota));
  return jsonb_build_object('codigo_aliado', v_aliado.codigo_aliado, 'retenido', v_aliado.estado <> 'activo');
end;
$$;

-- Eventos (§4.8) --------------------------------------------------------------------------------------------------

-- Valida un evento pendiente y otorga +100 (clave evento:{id}). Exige las 4 condiciones del §4.8.
create function public.admin_validar_evento(p_admin uuid, p_evento uuid, p_nota text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin   text := interno.exigir_admin(p_admin);
  v_evento  public.eventos%rowtype;
  v_codigo  text;
  v_faltan  text[] := '{}';
begin
  select * into v_evento from public.eventos e where e.id = p_evento for update;
  if not found then
    raise exception 'evento_inexistente: el evento no existe';
  end if;
  if v_evento.estado <> 'pendiente' then
    raise exception 'estado_invalido: el evento ya fue revisado (estado actual: %)', v_evento.estado;
  end if;
  if v_evento.fecha > (now() at time zone 'America/Bogota')::date then v_faltan := array_append(v_faltan, 'el evento aún no se ha realizado'); end if;
  if not v_evento.geenera_involucrada then v_faltan := array_append(v_faltan, 'GEENERA no estuvo involucrada'); end if;
  if not v_evento.registro_asistentes then v_faltan := array_append(v_faltan, 'no hay registro de asistentes'); end if;
  if v_evento.empresas_perfil_count < 5 then v_faltan := array_append(v_faltan, 'menos de 5 empresas dentro del perfil'); end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'evento_incompleto: %', array_to_string(v_faltan, '; ');
  end if;

  update public.eventos e
  set estado = 'validado', validado_por = p_admin, validado_at = now(), revision_nota = nullif(left(btrim(coalesce(p_nota, '')), 1000), '')
  where e.id = p_evento;

  insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por)
  values (v_evento.aliado_id, 'ganado', 'evento_validado', 'eventos', p_evento::text, 'evento:' || p_evento, 'admin:' || p_admin)
  on conflict (clave_unica) do nothing;

  select a.codigo_aliado into v_codigo from public.aliados a where a.id = v_evento.aliado_id;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'validar_evento', v_evento.aliado_id, v_codigo,
    'evento:' || p_evento, jsonb_build_object('nombre_evento', v_evento.nombre_evento, 'nota', p_nota));
  return jsonb_build_object('evento_id', p_evento, 'estado', 'validado', 'codigo_aliado', v_codigo);
end;
$$;

create function public.admin_rechazar_evento(p_admin uuid, p_evento uuid, p_motivo text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_motivo text := interno.texto_obligatorio(p_motivo, 'el motivo');
  v_evento public.eventos%rowtype;
  v_codigo text;
begin
  select * into v_evento from public.eventos e where e.id = p_evento for update;
  if not found then
    raise exception 'evento_inexistente: el evento no existe';
  end if;
  if v_evento.estado <> 'pendiente' then
    raise exception 'estado_invalido: el evento ya fue revisado (estado actual: %)', v_evento.estado;
  end if;
  update public.eventos e
  set estado = 'rechazado', validado_por = p_admin, validado_at = now(), revision_nota = v_motivo
  where e.id = p_evento;
  select a.codigo_aliado into v_codigo from public.aliados a where a.id = v_evento.aliado_id;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'rechazar_evento', v_evento.aliado_id, v_codigo,
    'evento:' || p_evento, jsonb_build_object('nombre_evento', v_evento.nombre_evento, 'motivo', v_motivo));
  return jsonb_build_object('evento_id', p_evento, 'estado', 'rechazado', 'codigo_aliado', v_codigo);
end;
$$;

-- El aliado reporta un evento desde el Hub (POST /api/eventos). p_evento lo genera el servidor junto con la
-- URL firmada del archivo, que debe estar en {aliado_id}/{evento_id}/ del bucket eventos.
create function public.registrar_evento(p_aliado uuid, p_evento uuid, p_datos jsonb, p_archivo text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_estado   text;
  v_nombre   text := btrim(coalesce(p_datos ->> 'nombre_evento', ''));
  v_tipo     text := nullif(btrim(coalesce(p_datos ->> 'tipo_evento', '')), '');
  v_desc     text := nullif(btrim(coalesce(p_datos ->> 'descripcion', '')), '');
  v_hoy      date := (now() at time zone 'America/Bogota')::date;
  v_fecha    date;
  v_empresas integer;
  v_archivo  text := nullif(btrim(coalesce(p_archivo, '')), '');
begin
  select a.estado into v_estado from public.aliados a where a.id = p_aliado for update;
  if v_estado is distinct from 'activo' then
    raise exception 'aliado_no_activo: la cuenta no está activa';
  end if;
  if (select count(*) from public.eventos e where e.aliado_id = p_aliado and e.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'limite_eventos: máximo 5 eventos reportados por día';
  end if;

  if char_length(v_nombre) < 3 or char_length(v_nombre) > 150 then
    raise exception 'evento_invalido: el nombre del evento debe tener entre 3 y 150 caracteres';
  end if;
  if char_length(v_tipo) > 60 or char_length(v_desc) > 1000 then
    raise exception 'evento_invalido: el tipo o la descripción son demasiado largos';
  end if;
  begin
    v_fecha := (p_datos ->> 'fecha')::date;
    v_empresas := coalesce((p_datos ->> 'empresas_perfil_count')::integer, 0);
  exception when others then
    raise exception 'evento_invalido: la fecha o el número de empresas no son válidos';
  end;
  if v_fecha is null or v_fecha > v_hoy or v_fecha < v_hoy - 365 then
    raise exception 'evento_invalido: la fecha debe ser la de un evento ya realizado en el último año';
  end if;
  if v_empresas < 0 or v_empresas > 10000 then
    raise exception 'evento_invalido: el número de empresas dentro del perfil no es válido';
  end if;
  if v_archivo is not null and (
       v_archivo not like p_aliado || '/' || p_evento || '/%' or v_archivo like '%..%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'eventos' and o.name = v_archivo)) then
    raise exception 'archivo_invalido: el registro de asistentes no corresponde a este evento';
  end if;
  if exists (select 1 from public.eventos e where e.id = p_evento) then
    raise exception 'evento_duplicado: este evento ya fue reportado';
  end if;

  insert into public.eventos (id, aliado_id, nombre_evento, tipo_evento, fecha, geenera_involucrada, registro_asistentes,
                              registro_asistentes_path, empresas_perfil_count, descripcion)
  values (p_evento, p_aliado, v_nombre, v_tipo, v_fecha, coalesce((p_datos ->> 'geenera_involucrada')::boolean, false),
          coalesce((p_datos ->> 'registro_asistentes')::boolean, false) or v_archivo is not null,
          v_archivo, v_empresas, v_desc);

  return jsonb_build_object('evento_id', p_evento, 'estado', 'pendiente');
end;
$$;

-- Conflictos de Clientify (§5.1) ----------------------------------------------------------------------------------

-- Cierra un conflicto. Opcionalmente acepta el valor de Clientify en avance_empresa (cambia la calidad, no los
-- puntos) y/o registra un ajuste de puntos, todo en la misma transacción.
create function public.admin_resolver_conflicto(
  p_admin uuid, p_conflicto uuid, p_nota text,
  p_aceptar_valor boolean default false, p_ajuste integer default null, p_clave uuid default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin     text := interno.exigir_admin(p_admin);
  v_nota      text := interno.texto_obligatorio(p_nota, 'la nota');
  v_conf      public.avance_conflictos%rowtype;
  v_aliado    uuid;
  v_codigo    text;
  v_aplicados integer;
begin
  select * into v_conf from public.avance_conflictos c where c.id = p_conflicto for update;
  if not found then
    raise exception 'conflicto_inexistente: el conflicto no existe';
  end if;
  if v_conf.resuelto_at is not null then
    raise exception 'estado_invalido: el conflicto ya fue resuelto';
  end if;
  select e.aliado_id, a.codigo_aliado into v_aliado, v_codigo
  from public.empresas e join public.aliados a on a.id = e.aliado_id where e.id = v_conf.empresa_id;

  if p_aceptar_valor then
    if v_conf.variable not in ('calificado', 'perfecto', 'fuera_perfil', 'oportunidad_tecnica', 'propuesta_comercial',
                               'negocio_cerrado', 'informacion_falsa', 'integridad_informacion') then
      raise exception 'dato_invalido: variable desconocida %', v_conf.variable;
    end if;
    execute format('update public.avance_empresa set %I = $1 where empresa_id = $2', v_conf.variable)
      using v_conf.valor_clientify, v_conf.empresa_id;
  end if;

  if p_ajuste is not null and p_ajuste <> 0 then
    v_aplicados := interno.insertar_ajuste(p_admin, v_aliado, p_ajuste,
      'Conflicto de Clientify (' || v_conf.variable || '): ' || v_nota, p_clave);
  end if;

  update public.avance_conflictos c set resuelto_at = now(), resuelto_por = p_admin, nota = v_nota where c.id = p_conflicto;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'resolver_conflicto', v_aliado, v_codigo,
    'conflicto:' || p_conflicto, jsonb_build_object('variable', v_conf.variable, 'aceptar_valor', p_aceptar_valor,
      'ajuste', p_ajuste, 'aplicados', v_aplicados, 'nota', v_nota));
  return jsonb_build_object('conflicto_id', p_conflicto, 'resuelto', true, 'puntos_aplicados', v_aplicados);
end;
$$;

revoke execute on function public.admin_aprobar_aliado(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_rechazar_aliado(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_suspender_aliado(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_reactivar_aliado(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_ajuste_puntos(uuid, text, integer, text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_baja_calidad(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_validar_evento(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_rechazar_evento(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.registrar_evento(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.admin_resolver_conflicto(uuid, uuid, text, boolean, integer, uuid) from public, anon, authenticated;
grant execute on function public.admin_aprobar_aliado(uuid, text) to service_role;
grant execute on function public.admin_rechazar_aliado(uuid, text, text) to service_role;
grant execute on function public.admin_suspender_aliado(uuid, text, text) to service_role;
grant execute on function public.admin_reactivar_aliado(uuid, text, text) to service_role;
grant execute on function public.admin_ajuste_puntos(uuid, text, integer, text, uuid) to service_role;
grant execute on function public.admin_baja_calidad(uuid, text, text) to service_role;
grant execute on function public.admin_validar_evento(uuid, uuid, text) to service_role;
grant execute on function public.admin_rechazar_evento(uuid, uuid, text) to service_role;
grant execute on function public.registrar_evento(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.admin_resolver_conflicto(uuid, uuid, text, boolean, integer, uuid) to service_role;

-- Vistas ------------------------------------------------------------------------------------------------------------
-- Todas security_invoker. Las de admin además exigen es_admin(): un aliado que las consulte no ve filas.
-- Ninguna expone aliados.id; los admins aparecen por su codigo_aliado.

create view public.v_mis_eventos
with (security_invoker = true)
as
select e.id as evento_id, e.nombre_evento, e.tipo_evento, e.fecha, e.geenera_involucrada, e.registro_asistentes,
       e.registro_asistentes_path is not null as tiene_archivo, e.empresas_perfil_count, e.descripcion,
       e.estado, e.revision_nota, e.validado_at, e.created_at
from public.eventos e
where e.aliado_id = (select auth.uid());

create view public.v_admin_resumen
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
  (select count(*) from public.aliados a where a.racha_semana_4)::integer                            as rachas_completas
where (select interno.es_admin());

create view public.v_admin_aliados
with (security_invoker = true)
as
select
  a.codigo_aliado, a.nombre_completo, a.correo, a.celular, a.regional, a.tipo_aliado,
  po.organizacion, po.cargo, pa.como_llega_empresas,
  a.estado, a.rol, a.nivel, a.puntos_nivel, a.puntos_disponibles, a.calidad_referidos,
  a.racha_semana_1, a.racha_semana_2, a.racha_semana_3, a.racha_semana_4,
  coalesce(r.total, 0)::integer        as referidos_total,
  coalesce(r.calificados, 0)::integer  as referidos_calificados,
  coalesce(mr.retenidos, 0)::integer   as movimientos_retenidos,
  a.clientify_sync_estado, a.clientify_sync_error,
  a.created_at, a.aprobado_at, ap.codigo_aliado as aprobado_por
from public.aliados a
left join public.aliados_perfil_organizacion po on po.aliado_id = a.id
left join public.aliados_perfil_alcance pa on pa.aliado_id = a.id
left join public.aliados ap on ap.id = a.aprobado_por
left join lateral (
  select count(*) as total, count(*) filter (where v.calificado = 'si') as calificados
  from public.empresas e left join public.avance_empresa v on v.empresa_id = e.id
  where e.aliado_id = a.id
) r on true
left join lateral (select count(*) as retenidos from public.movimientos_retenidos m where m.aliado_id = a.id) mr on true
where (select interno.es_admin());

create view public.v_admin_movimientos
with (security_invoker = true)
as
select
  a.codigo_aliado, m.secuencia, m.fecha, m.tipo, m.motivo, r.descripcion, m.puntos, m.puntos_aplicados,
  e.empresa, m.nota,
  case when m.creado_por like 'admin:%' then 'admin:' || coalesce(ad.codigo_aliado, '?') else m.creado_por end as creado_por
from public.movimientos_puntos m
join public.aliados a on a.id = m.aliado_id
join public.reglas_puntos r on r.motivo = m.motivo
left join public.empresas e
  on m.vinculo = 'empresas'
 and e.id = case when m.vinculo_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then m.vinculo_id::uuid end
left join public.aliados ad
  on m.creado_por like 'admin:%'
 and ad.id = case when substr(m.creado_por, 7) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(m.creado_por, 7)::uuid end
where (select interno.es_admin());

create view public.v_admin_eventos
with (security_invoker = true)
as
select
  e.id as evento_id, a.codigo_aliado, a.nombre_completo, a.tipo_aliado,
  e.nombre_evento, e.tipo_evento, e.fecha, e.geenera_involucrada, e.registro_asistentes,
  e.registro_asistentes_path is not null as tiene_archivo, e.empresas_perfil_count, e.descripcion,
  e.estado, e.revision_nota, e.validado_at, rv.codigo_aliado as revisado_por, e.created_at,
  (e.fecha <= (now() at time zone 'America/Bogota')::date and e.geenera_involucrada
   and e.registro_asistentes and e.empresas_perfil_count >= 5) as cumple_condiciones
from public.eventos e
join public.aliados a on a.id = e.aliado_id
left join public.aliados rv on rv.id = e.validado_por
where (select interno.es_admin());

create view public.v_admin_conflictos
with (security_invoker = true)
as
select
  c.id as conflicto_id, a.codigo_aliado, a.nombre_completo, e.empresa, c.variable, c.valor_hub, c.valor_clientify,
  c.detectado_at, c.resuelto_at, rs.codigo_aliado as resuelto_por, c.nota
from public.avance_conflictos c
join public.empresas e on e.id = c.empresa_id
join public.aliados a on a.id = e.aliado_id
left join public.aliados rs on rs.id = c.resuelto_por
where (select interno.es_admin());

create view public.v_admin_acciones
with (security_invoker = true)
as
select x.created_at, x.admin_codigo, x.accion, x.aliado_codigo, x.objetivo, x.detalle
from public.acciones_admin x
where (select interno.es_admin());

revoke all on public.v_mis_eventos, public.v_admin_resumen, public.v_admin_aliados, public.v_admin_movimientos,
              public.v_admin_eventos, public.v_admin_conflictos, public.v_admin_acciones
  from public, anon, authenticated;
grant select on public.v_mis_eventos, public.v_admin_resumen, public.v_admin_aliados, public.v_admin_movimientos,
                public.v_admin_eventos, public.v_admin_conflictos, public.v_admin_acciones
  to authenticated, service_role;
