-- Fase 2 · 01 — Alta de aliados desde Supabase Auth (CLAUDE.md §2, §3, §11).
--
-- El front llama a supabase.auth.signUp({ email, password, options: { data } }).
-- Este trigger valida `data` (raw_user_meta_data), genera el codigo_aliado y crea el aliado
-- con su perfil. Si algo no es válido, el registro completo se rechaza: no quedan usuarios
-- de Auth sin aliado. La contraseña nunca pasa por aquí (la gestiona Supabase Auth).

-- Estado `pendiente`: la cuenta existe pero GEENERA aún no la aprueba (decisión del equipo).
alter table public.aliados drop constraint aliados_estado_check;
alter table public.aliados
  add constraint aliados_estado_check check (estado in ('pendiente', 'activo', 'suspendido')),
  alter column estado set default 'pendiente',
  add column aprobado_at            timestamptz,
  add column aprobado_por           uuid references public.aliados (id) on delete set null,
  add column terminos_aceptados_at  timestamptz not null,
  add column terminos_version       text not null,
  add column politica_datos_version text not null;

comment on column public.aliados.terminos_version is 'Versión de los Términos y Condiciones aceptada (fecha de entrada en vigor).';
comment on column public.aliados.politica_datos_version is 'Versión de la Política de Tratamiento de Datos vigente cuando autorizó (prueba de la autorización, Ley 1581).';

create index aliados_aprobado_por_idx on public.aliados (aprobado_por) where aprobado_por is not null;

-- Versiones vigentes de los documentos legales que se aceptan al registrarse.
-- Coinciden con los PDF publicados en assets/legal/. Al publicar una versión nueva,
-- se sube el PDF con la fecha nueva en el nombre y se cambia aquí con una migración.
create function interno.version_terminos_vigente()
returns text
language sql
immutable
set search_path = ''
as $$
  select '2026-02-06'::text;
$$;

create function interno.version_politica_datos_vigente()
returns text
language sql
immutable
set search_path = ''
as $$
  select '2026-09-25'::text;
$$;

-- Lee un texto de los metadatos del registro: recortado y NULL si viene vacío.
create function interno.meta_texto(meta jsonb, clave text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(meta ->> clave), '');
$$;

create function interno.handle_new_aliado()
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

revoke execute on function interno.handle_new_aliado() from public, anon, authenticated;

create trigger on_auth_user_created_aliado
  after insert on auth.users
  for each row execute function interno.handle_new_aliado();

-- Si el aliado cambia su correo en Auth (tras confirmarlo), se replica en aliados.correo.
create function interno.sincronizar_correo_aliado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.aliados set correo = new.email where id = new.id;
  return new;
end;
$$;

revoke execute on function interno.sincronizar_correo_aliado() from public, anon, authenticated;

create trigger on_auth_user_email_updated_aliado
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email and new.email is not null)
  execute function interno.sincronizar_correo_aliado();
