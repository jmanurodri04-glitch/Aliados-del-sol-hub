-- Academy nueva, administrable desde el panel (decisión del equipo, oct 2026; CLAUDE.md §4.9, §9).
--
-- El catálogo de minicursos vive en public.modulos (el mismo que ya da los Puntos Sol: +5 por módulo, tope de 20 al mes,
-- sin cambios en esa regla). Cada minicurso tiene la estructura fija de 6 pasos (Contexto, Aprende, Aplica, Descarga,
-- Comprueba y Activa); su contenido va aparte, en public.modulos_contenido, porque `modulos` lo puede leer cualquier sesión
-- y el contenido de los cursos «solo aliados» no debe salir sin una cuenta activa.
-- Certificaciones (grupos ordenados de minicursos) y herramientas descargables también se administran desde el panel.
-- El Hub lee todo con public.academy_catalogo() y el panel escribe con public.admin_guardar_* por /api/admin.
-- Los XP de la Academy no son Puntos Sol: el Hub los calcula con los cursos completados (formato del curso y certificaciones).

alter table public.acciones_admin
  drop constraint acciones_admin_accion_check,
  add constraint acciones_admin_accion_check check (accion in (
    'aprobar_aliado', 'rechazar_aliado', 'suspender_aliado', 'reactivar_aliado',
    'ajuste_puntos', 'baja_calidad', 'validar_evento', 'rechazar_evento', 'resolver_conflicto',
    'anular_canje', 'guardar_recompensa', 'invitar_operador', 'estado_operador', 'eliminar_operador',
    'otorgar_meddpicc', 'reintentar_correo', 'reintentar_aviso_n8n',
    'guardar_curso', 'guardar_certificacion', 'guardar_herramienta'));

-- Minicursos (catálogo) ---------------------------------------------------------------------------------------------

alter table public.modulos
  drop constraint modulos_codigo_formato,
  add constraint modulos_codigo_formato check (codigo ~ '^[a-z0-9_-]{1,80}$'),
  add column escuela     text check (escuela in ('relaciones', 'ia', 'negocios', 'finanzas', 'energia', 'marca', 'ads')),
  add column formato     text check (formato in ('flash', 'micro', 'curso', 'masterclass')),
  add column minutos     integer check (minutos between 1 and 240),
  add column nivel       text check (nivel in ('Principiante', 'Intermedio', 'Avanzado')),
  add column aliados     text[] not null default '{todos}'
                         check (aliados <@ array['todos', 'financiero', 'referidor', 'gremio'] and cardinality(aliados) > 0),
  add column acceso      text not null default 'aliado' check (acceso in ('free', 'aliado')),
  add column destacado   boolean not null default false,
  add column nuevo       boolean not null default false,
  add column popular     boolean not null default false,
  add column rapido      boolean not null default false,
  add column ruta        text check (ruta in ('e1', 'e2', 'e3', 'e4')),
  add column descripcion text check (char_length(descripcion) <= 300),
  add column herramienta text,
  add column popularidad integer not null default 50 check (popularidad between 0 and 1000),
  add column publicado   date not null default current_date,
  -- Un minicurso de la Academy nueva (escuela no nula) tiene todos sus datos.
  add constraint modulos_academy_completo check (
    escuela is null or (formato is not null and minutos is not null and nivel is not null and descripcion is not null and herramienta is not null));

comment on column public.modulos.escuela is 'Escuela de la Academy (NULL = curso de la Academy anterior, desactivado).';
comment on column public.modulos.ruta is 'Nivel de la escuela Energía (e1–e4); las rutas por tipo de aliado viven en el código del Hub.';
comment on column public.modulos.herramienta is 'Herramienta del paso «Descarga» (academy_herramientas.codigo).';

-- Contenido de los 6 pasos de cada minicurso. Solo lo leen el catálogo (función) y los admins.
create table public.modulos_contenido (
  modulo_id  uuid primary key references public.modulos (id) on delete cascade,
  contenido  jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.modulos_contenido is 'Contenido de los 6 pasos de cada minicurso: aprenderas, contexto, lecciones, ejercicio, pasos, quiz y accion.';
alter table public.modulos_contenido enable row level security;
revoke all on public.modulos_contenido from public, anon, authenticated;
grant select on public.modulos_contenido to authenticated;
create policy modulos_contenido_admin on public.modulos_contenido for select to authenticated using ((select interno.es_admin()));
create trigger modulos_contenido_set_updated_at
  before update on public.modulos_contenido
  for each row execute function interno.set_updated_at();

-- Certificaciones y herramientas ------------------------------------------------------------------------------------

create table public.academy_certificaciones (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique check (codigo ~ '^[a-z0-9-]{2,60}$'),
  nombre      text not null check (char_length(nombre) between 3 and 80),
  descripcion text not null check (char_length(descripcion) between 3 and 300),
  escuela     text not null check (escuela in ('relaciones', 'ia', 'negocios', 'finanzas', 'energia', 'marca', 'ads')),
  sigla       text not null check (sigla ~ '^[A-Z0-9]{1,3}$'),
  cursos      text[] not null check (cardinality(cursos) between 1 and 60),
  orden       integer not null default 0,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.academy_certificaciones is 'Certificaciones de la Academy: grupo ordenado de minicursos (modulos.codigo); se obtiene al completarlos todos.';

create table public.academy_herramientas (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique check (codigo ~ '^t-[a-z0-9-]{1,40}$'),
  nombre         text not null check (char_length(nombre) between 3 and 80),
  categoria      text not null check (char_length(categoria) between 2 and 40),
  icono          text not null default 'book'
                 check (icono in ('relaciones', 'ia', 'negocios', 'finanzas', 'energia', 'marca', 'ads', 'map', 'check', 'book', 'calc', 'ask', 'cal', 'grid', 'scan')),
  descripcion    text not null check (char_length(descripcion) between 3 and 300),
  acceso         text not null default 'aliado' check (acceso in ('free', 'aliado')),
  archivo_path   text check (archivo_path ~ '^herramientas/[0-9a-f-]{36}\.(pdf|xlsx|docx|pptx)$'),
  archivo_nombre text check (char_length(archivo_nombre) between 1 and 120),
  orden          integer not null default 0,
  activa         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.academy_herramientas is 'Herramientas descargables de la Academy. Sin archivo = material incorporado en el Hub (academy-tools.js).';
comment on column public.academy_herramientas.archivo_path is 'Archivo subido desde el panel (bucket público academy).';

alter table public.academy_certificaciones enable row level security;
alter table public.academy_herramientas enable row level security;
revoke all on public.academy_certificaciones, public.academy_herramientas from public, anon, authenticated;
grant select on public.academy_certificaciones, public.academy_herramientas to authenticated;
create policy academy_certificaciones_admin on public.academy_certificaciones for select to authenticated using ((select interno.es_admin()));
create policy academy_herramientas_admin on public.academy_herramientas for select to authenticated using ((select interno.es_admin()));
create trigger academy_certificaciones_set_updated_at before update on public.academy_certificaciones
  for each row execute function interno.set_updated_at();
create trigger academy_herramientas_set_updated_at before update on public.academy_herramientas
  for each row execute function interno.set_updated_at();

-- Archivos de las herramientas: bucket público (son materiales sin datos personales; «solo aliados» es una restricción
-- de la interfaz, igual que el material incorporado). Sin políticas: se sube con una URL firmada que da /api/admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('academy', 'academy', true, 10485760, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

-- Validación del contenido de un minicurso --------------------------------------------------------------------------

create function interno.texto_valido(p_valor jsonb, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_valor) = 'string' and char_length(btrim(p_valor #>> '{}')) between 1 and p_max;
$$;

-- Lanza dato_invalido con el campo que falla.
create function interno.validar_contenido_curso(p jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  x jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'dato_invalido: falta el contenido del curso';
  end if;
  if jsonb_typeof(p -> 'aprenderas') is distinct from 'array' or jsonb_array_length(p -> 'aprenderas') not between 1 and 8 then
    raise exception 'dato_invalido: «Lo que aprenderás» necesita entre 1 y 8 puntos';
  end if;
  for x in select * from jsonb_array_elements(p -> 'aprenderas') loop
    if not interno.texto_valido(x, 200) then raise exception 'dato_invalido: cada punto de «Lo que aprenderás» va de 1 a 200 caracteres'; end if;
  end loop;
  if not interno.texto_valido(p -> 'contexto', 6000) then
    raise exception 'dato_invalido: el Contexto va de 1 a 6000 caracteres';
  end if;
  if jsonb_typeof(p -> 'lecciones') is distinct from 'array' or jsonb_array_length(p -> 'lecciones') not between 1 and 8 then
    raise exception 'dato_invalido: «Aprende» necesita entre 1 y 8 microlecciones';
  end if;
  for x in select * from jsonb_array_elements(p -> 'lecciones') loop
    if not interno.texto_valido(x -> 'titulo', 160) or not interno.texto_valido(x -> 'texto', 8000) then
      raise exception 'dato_invalido: cada microlección necesita título (máx. 160) y texto (máx. 8000)';
    end if;
  end loop;
  if not interno.texto_valido(p -> 'ejercicio', 3000) then
    raise exception 'dato_invalido: el ejercicio de «Aplica» va de 1 a 3000 caracteres';
  end if;
  if jsonb_typeof(coalesce(p -> 'pasos', '[]')) is distinct from 'array' or jsonb_array_length(coalesce(p -> 'pasos', '[]')) > 10 then
    raise exception 'dato_invalido: «Aplica» admite hasta 10 pasos';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'pasos', '[]')) loop
    if not interno.texto_valido(x, 400) then raise exception 'dato_invalido: cada paso de «Aplica» va de 1 a 400 caracteres'; end if;
  end loop;
  if jsonb_typeof(p -> 'quiz') is distinct from 'array' or jsonb_array_length(p -> 'quiz') not between 1 and 5 then
    raise exception 'dato_invalido: «Comprueba» necesita entre 1 y 5 preguntas';
  end if;
  for x in select * from jsonb_array_elements(p -> 'quiz') loop
    if not interno.texto_valido(x -> 'pregunta', 300)
       or jsonb_typeof(x -> 'opciones') is distinct from 'array'
       or jsonb_array_length(x -> 'opciones') not between 2 and 4
       or exists (select 1 from jsonb_array_elements(x -> 'opciones') o where not interno.texto_valido(o, 200))
       or jsonb_typeof(x -> 'correcta') is distinct from 'number'
       or (x ->> 'correcta')::numeric not in (0, 1, 2, 3)
       or (x ->> 'correcta')::integer >= jsonb_array_length(x -> 'opciones') then
      raise exception 'dato_invalido: cada pregunta necesita texto, de 2 a 4 opciones y la respuesta correcta';
    end if;
  end loop;
  if not interno.texto_valido(p -> 'accion', 1000) then
    raise exception 'dato_invalido: la acción de «Activa» va de 1 a 1000 caracteres';
  end if;
end;
$$;

-- Catálogo para el Hub (sitio público y sesión) ---------------------------------------------------------------------

-- Sin una cuenta activa, el contenido de los cursos «solo aliados» llega reducido al temario (títulos de las
-- microlecciones y «Lo que aprenderás»), para mostrarlo bloqueado.
create function public.academy_catalogo()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_completo boolean := exists (select 1 from public.aliados a where a.id = (select auth.uid()) and a.estado = 'activo');
begin
  return jsonb_build_object(
    'cursos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'codigo', m.codigo, 'titulo', m.nombre, 'escuela', m.escuela, 'formato', m.formato, 'minutos', m.minutos,
        'nivel', m.nivel, 'aliados', to_jsonb(m.aliados), 'acceso', m.acceso, 'destacado', m.destacado, 'nuevo', m.nuevo,
        'popular', m.popular, 'rapido', m.rapido, 'ruta', m.ruta, 'descripcion', m.descripcion, 'herramienta', m.herramienta,
        'puntos', m.puntos, 'popularidad', m.popularidad, 'publicado', m.publicado, 'orden', m.orden,
        'completo', v_completo or m.acceso = 'free',
        'contenido', case
          when v_completo or m.acceso = 'free' then mc.contenido
          else jsonb_build_object(
            'aprenderas', mc.contenido -> 'aprenderas',
            'lecciones', (select coalesce(jsonb_agg(jsonb_build_object('titulo', l -> 'titulo')), '[]')
                          from jsonb_array_elements(mc.contenido -> 'lecciones') l))
        end) order by m.orden, m.codigo)
      from public.modulos m
      join public.modulos_contenido mc on mc.modulo_id = m.id
      where m.activo and m.escuela is not null), '[]'),
    'certificaciones', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'descripcion', c.descripcion,
        'escuela', c.escuela, 'sigla', c.sigla, 'cursos', to_jsonb(c.cursos)) order by c.orden, c.nombre)
      from public.academy_certificaciones c where c.activa), '[]'),
    'herramientas', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', h.codigo, 'nombre', h.nombre, 'categoria', h.categoria, 'icono', h.icono,
        'descripcion', h.descripcion, 'acceso', h.acceso, 'archivo_path', h.archivo_path, 'archivo_nombre', h.archivo_nombre)
        order by h.orden, h.nombre)
      from public.academy_herramientas h where h.activa), '[]'));
end;
$$;
revoke execute on function public.academy_catalogo() from public;
grant execute on function public.academy_catalogo() to anon, authenticated, service_role;

-- Escrituras del panel (solo service_role, por /api/admin) -----------------------------------------------------------

-- Crea (p_datos.nuevo = true) o edita un minicurso, con su contenido. El código no cambia después de creado.
create function public.admin_guardar_curso(p_admin uuid, p_datos jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin   text := interno.exigir_admin(p_admin);
  v_codigo  text := lower(btrim(coalesce(p_datos ->> 'codigo', '')));
  v_nuevo   boolean := coalesce((p_datos ->> 'nuevo')::boolean, false);
  v_aliados text[];
  v_id      uuid;
  v_antes   public.modulos%rowtype;
begin
  if v_codigo !~ '^[a-z0-9-]{3,80}$' then
    raise exception 'dato_invalido: el código usa minúsculas, números y guiones (3 a 80)';
  end if;
  if not interno.texto_valido(p_datos -> 'titulo', 120) or char_length(btrim(p_datos ->> 'titulo')) < 3 then
    raise exception 'dato_invalido: el título va de 3 a 120 caracteres';
  end if;
  if not interno.texto_valido(p_datos -> 'descripcion', 300) then
    raise exception 'dato_invalido: la descripción corta va de 1 a 300 caracteres';
  end if;
  if coalesce(p_datos ->> 'escuela', '') not in ('relaciones', 'ia', 'negocios', 'finanzas', 'energia', 'marca', 'ads') then
    raise exception 'dato_invalido: elige la escuela';
  end if;
  if coalesce(p_datos ->> 'formato', '') not in ('flash', 'micro', 'curso', 'masterclass') then
    raise exception 'dato_invalido: elige el formato';
  end if;
  if coalesce(p_datos ->> 'nivel', '') not in ('Principiante', 'Intermedio', 'Avanzado') then
    raise exception 'dato_invalido: elige el nivel';
  end if;
  if jsonb_typeof(p_datos -> 'minutos') is distinct from 'number' or (p_datos ->> 'minutos')::numeric not between 1 and 240 then
    raise exception 'dato_invalido: la duración va de 1 a 240 minutos';
  end if;
  if coalesce((p_datos ->> 'puntos')::text, '') not in ('0', '5') then
    raise exception 'dato_invalido: los Puntos Sol del curso son 5 o 0';
  end if;
  if coalesce(p_datos ->> 'acceso', '') not in ('free', 'aliado') then
    raise exception 'dato_invalido: elige si es gratis o solo para aliados';
  end if;
  if p_datos ? 'ruta' and p_datos ->> 'ruta' is not null and p_datos ->> 'ruta' not in ('e1', 'e2', 'e3', 'e4') then
    raise exception 'dato_invalido: el nivel de Energía es e1, e2, e3 o e4';
  end if;
  if jsonb_typeof(p_datos -> 'aliados') is distinct from 'array' then
    raise exception 'dato_invalido: elige para qué tipos de aliado es';
  end if;
  select array_agg(distinct x) into v_aliados from jsonb_array_elements_text(p_datos -> 'aliados') x;
  if v_aliados is null or not v_aliados <@ array['todos', 'financiero', 'referidor', 'gremio'] then
    raise exception 'dato_invalido: elige para qué tipos de aliado es';
  end if;
  if not exists (select 1 from public.academy_herramientas h where h.codigo = p_datos ->> 'herramienta') then
    raise exception 'dato_invalido: elige la herramienta del paso «Descarga»';
  end if;
  perform interno.validar_contenido_curso(p_datos -> 'contenido');

  select * into v_antes from public.modulos m where m.codigo = v_codigo for update;
  if v_nuevo and found then
    raise exception 'estado_invalido: ya existe un curso con ese código';
  end if;
  if not v_nuevo and not found then
    raise exception 'curso_inexistente: el curso no existe';
  end if;
  if not v_nuevo and v_antes.escuela is null then
    raise exception 'no_permitido: este curso es de la Academy anterior';
  end if;

  if v_nuevo then
    insert into public.modulos (codigo, nombre, orden, activo, puntos, escuela, formato, minutos, nivel, aliados, acceso,
                                destacado, nuevo, popular, rapido, ruta, descripcion, herramienta, popularidad, publicado)
    values (v_codigo, btrim(p_datos ->> 'titulo'), coalesce((select max(orden) from public.modulos), 0) + 1,
            coalesce((p_datos ->> 'activo')::boolean, true), (p_datos ->> 'puntos')::integer,
            p_datos ->> 'escuela', p_datos ->> 'formato', (p_datos ->> 'minutos')::integer, p_datos ->> 'nivel', v_aliados,
            p_datos ->> 'acceso', coalesce((p_datos ->> 'destacado')::boolean, false), coalesce((p_datos ->> 'nuevo_tag')::boolean, true),
            coalesce((p_datos ->> 'popular')::boolean, false), coalesce((p_datos ->> 'rapido')::boolean, false),
            nullif(p_datos ->> 'ruta', ''), btrim(p_datos ->> 'descripcion'), p_datos ->> 'herramienta', 50, current_date)
    returning id into v_id;
    insert into public.modulos_contenido (modulo_id, contenido) values (v_id, p_datos -> 'contenido');
  else
    update public.modulos m set
      nombre = btrim(p_datos ->> 'titulo'), activo = coalesce((p_datos ->> 'activo')::boolean, m.activo),
      puntos = (p_datos ->> 'puntos')::integer, escuela = p_datos ->> 'escuela', formato = p_datos ->> 'formato',
      minutos = (p_datos ->> 'minutos')::integer, nivel = p_datos ->> 'nivel', aliados = v_aliados, acceso = p_datos ->> 'acceso',
      destacado = coalesce((p_datos ->> 'destacado')::boolean, m.destacado), nuevo = coalesce((p_datos ->> 'nuevo_tag')::boolean, m.nuevo),
      popular = coalesce((p_datos ->> 'popular')::boolean, m.popular), rapido = coalesce((p_datos ->> 'rapido')::boolean, m.rapido),
      ruta = nullif(p_datos ->> 'ruta', ''), descripcion = btrim(p_datos ->> 'descripcion'), herramienta = p_datos ->> 'herramienta'
    where m.id = v_antes.id;
    v_id := v_antes.id;
    insert into public.modulos_contenido (modulo_id, contenido) values (v_id, p_datos -> 'contenido')
    on conflict (modulo_id) do update set contenido = excluded.contenido;
  end if;

  perform interno.registrar_accion_admin(p_admin, v_admin, 'guardar_curso', null, null, 'curso:' || v_codigo,
    jsonb_build_object('nuevo', v_nuevo, 'titulo', btrim(p_datos ->> 'titulo'), 'puntos', (p_datos ->> 'puntos')::integer,
                       'activo', coalesce((p_datos ->> 'activo')::boolean, true),
                       'puntos_anteriores', case when v_nuevo then null else v_antes.puntos end));
  return jsonb_build_object('codigo', v_codigo, 'nuevo', v_nuevo);
end;
$$;

-- Crea o edita una certificación y su lista ordenada de minicursos.
create function public.admin_guardar_certificacion(p_admin uuid, p_datos jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_codigo text := lower(btrim(coalesce(p_datos ->> 'codigo', '')));
  v_nuevo  boolean := coalesce((p_datos ->> 'nuevo')::boolean, false);
  v_cursos text[];
  v_falta  text;
begin
  if v_codigo !~ '^[a-z0-9-]{2,60}$' then
    raise exception 'dato_invalido: el código usa minúsculas, números y guiones (2 a 60)';
  end if;
  if not interno.texto_valido(p_datos -> 'nombre', 80) or char_length(btrim(p_datos ->> 'nombre')) < 3 then
    raise exception 'dato_invalido: el nombre va de 3 a 80 caracteres';
  end if;
  if not interno.texto_valido(p_datos -> 'descripcion', 300) or char_length(btrim(p_datos ->> 'descripcion')) < 3 then
    raise exception 'dato_invalido: la descripción va de 3 a 300 caracteres';
  end if;
  if coalesce(p_datos ->> 'escuela', '') not in ('relaciones', 'ia', 'negocios', 'finanzas', 'energia', 'marca', 'ads') then
    raise exception 'dato_invalido: elige la escuela';
  end if;
  if coalesce(p_datos ->> 'sigla', '') !~ '^[A-Z0-9]{1,3}$' then
    raise exception 'dato_invalido: la sigla va de 1 a 3 letras o números en mayúscula';
  end if;
  if jsonb_typeof(p_datos -> 'cursos') is distinct from 'array' then
    raise exception 'dato_invalido: elige los minicursos de la certificación';
  end if;
  select array_agg(x order by o) into v_cursos
  from (select distinct on (x) x, o from jsonb_array_elements_text(p_datos -> 'cursos') with ordinality t(x, o) order by x, o) d;
  if v_cursos is null or cardinality(v_cursos) not between 1 and 60 then
    raise exception 'dato_invalido: la certificación necesita entre 1 y 60 minicursos';
  end if;
  select x into v_falta from unnest(v_cursos) x
  where not exists (select 1 from public.modulos m where m.codigo = x and m.escuela is not null) limit 1;
  if v_falta is not null then
    raise exception 'dato_invalido: el minicurso «%» no existe', v_falta;
  end if;

  if v_nuevo then
    if exists (select 1 from public.academy_certificaciones c where c.codigo = v_codigo) then
      raise exception 'estado_invalido: ya existe una certificación con ese código';
    end if;
    insert into public.academy_certificaciones (codigo, nombre, descripcion, escuela, sigla, cursos, orden, activa)
    values (v_codigo, btrim(p_datos ->> 'nombre'), btrim(p_datos ->> 'descripcion'), p_datos ->> 'escuela', p_datos ->> 'sigla',
            v_cursos, coalesce((select max(orden) from public.academy_certificaciones), 0) + 1,
            coalesce((p_datos ->> 'activa')::boolean, true));
  else
    update public.academy_certificaciones c set
      nombre = btrim(p_datos ->> 'nombre'), descripcion = btrim(p_datos ->> 'descripcion'), escuela = p_datos ->> 'escuela',
      sigla = p_datos ->> 'sigla', cursos = v_cursos, activa = coalesce((p_datos ->> 'activa')::boolean, c.activa)
    where c.codigo = v_codigo;
    if not found then
      raise exception 'certificacion_inexistente: la certificación no existe';
    end if;
  end if;

  perform interno.registrar_accion_admin(p_admin, v_admin, 'guardar_certificacion', null, null, 'certificacion:' || v_codigo,
    jsonb_build_object('nuevo', v_nuevo, 'nombre', btrim(p_datos ->> 'nombre'), 'cursos', cardinality(v_cursos)));
  return jsonb_build_object('codigo', v_codigo, 'nuevo', v_nuevo);
end;
$$;

-- Crea o edita una herramienta. Sin la clave archivo_path se conserva el archivo; con '' se quita.
-- Devuelve archivo_anterior cuando cambió, para que /api/admin lo borre del bucket.
create function public.admin_guardar_herramienta(p_admin uuid, p_datos jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin   text := interno.exigir_admin(p_admin);
  v_codigo  text := lower(btrim(coalesce(p_datos ->> 'codigo', '')));
  v_nuevo   boolean := coalesce((p_datos ->> 'nuevo')::boolean, false);
  v_antes   public.academy_herramientas%rowtype;
  v_archivo text;
  v_nombre  text;
begin
  if v_codigo !~ '^t-[a-z0-9-]{1,40}$' then
    raise exception 'dato_invalido: el código empieza por t- y usa minúsculas, números y guiones';
  end if;
  if not interno.texto_valido(p_datos -> 'nombre', 80) or char_length(btrim(p_datos ->> 'nombre')) < 3 then
    raise exception 'dato_invalido: el nombre va de 3 a 80 caracteres';
  end if;
  if not interno.texto_valido(p_datos -> 'categoria', 40) or char_length(btrim(p_datos ->> 'categoria')) < 2 then
    raise exception 'dato_invalido: la categoría va de 2 a 40 caracteres';
  end if;
  if not interno.texto_valido(p_datos -> 'descripcion', 300) or char_length(btrim(p_datos ->> 'descripcion')) < 3 then
    raise exception 'dato_invalido: la descripción va de 3 a 300 caracteres';
  end if;
  if coalesce(p_datos ->> 'acceso', '') not in ('free', 'aliado') then
    raise exception 'dato_invalido: elige si es gratis o solo para aliados';
  end if;
  if coalesce(p_datos ->> 'icono', '') not in ('relaciones', 'ia', 'negocios', 'finanzas', 'energia', 'marca', 'ads', 'map', 'check', 'book', 'calc', 'ask', 'cal', 'grid', 'scan') then
    raise exception 'dato_invalido: elige el ícono';
  end if;

  select * into v_antes from public.academy_herramientas h where h.codigo = v_codigo for update;
  if v_nuevo and found then
    raise exception 'estado_invalido: ya existe una herramienta con ese código';
  end if;
  if not v_nuevo and not found then
    raise exception 'herramienta_inexistente: la herramienta no existe';
  end if;

  if p_datos ? 'archivo_path' then
    v_archivo := nullif(p_datos ->> 'archivo_path', '');
    v_nombre := nullif(btrim(coalesce(p_datos ->> 'archivo_nombre', '')), '');
    if v_archivo is not null then
      if v_archivo !~ '^herramientas/[0-9a-f-]{36}\.(pdf|xlsx|docx|pptx)$'
         or not exists (select 1 from storage.objects o where o.bucket_id = 'academy' and o.name = v_archivo) then
        raise exception 'dato_invalido: el archivo no se subió';
      end if;
      if v_nombre is null or char_length(v_nombre) > 120 then
        raise exception 'dato_invalido: falta el nombre del archivo';
      end if;
    else
      v_nombre := null;
    end if;
  else
    v_archivo := v_antes.archivo_path;
    v_nombre := v_antes.archivo_nombre;
  end if;
  -- Una herramienta nueva necesita archivo: el material incorporado solo existe para las que ya traía el Hub.
  if v_nuevo and v_archivo is null then
    raise exception 'dato_invalido: sube el archivo de la herramienta';
  end if;

  if v_nuevo then
    insert into public.academy_herramientas (codigo, nombre, categoria, icono, descripcion, acceso, archivo_path, archivo_nombre, orden, activa)
    values (v_codigo, btrim(p_datos ->> 'nombre'), btrim(p_datos ->> 'categoria'), p_datos ->> 'icono', btrim(p_datos ->> 'descripcion'),
            p_datos ->> 'acceso', v_archivo, v_nombre, coalesce((select max(orden) from public.academy_herramientas), 0) + 1,
            coalesce((p_datos ->> 'activa')::boolean, true));
  else
    update public.academy_herramientas h set
      nombre = btrim(p_datos ->> 'nombre'), categoria = btrim(p_datos ->> 'categoria'), icono = p_datos ->> 'icono',
      descripcion = btrim(p_datos ->> 'descripcion'), acceso = p_datos ->> 'acceso', archivo_path = v_archivo,
      archivo_nombre = v_nombre, activa = coalesce((p_datos ->> 'activa')::boolean, h.activa)
    where h.id = v_antes.id;
  end if;

  perform interno.registrar_accion_admin(p_admin, v_admin, 'guardar_herramienta', null, null, 'herramienta:' || v_codigo,
    jsonb_build_object('nuevo', v_nuevo, 'nombre', btrim(p_datos ->> 'nombre'), 'archivo', v_archivo is not null));
  return jsonb_build_object('codigo', v_codigo, 'nuevo', v_nuevo,
    'archivo_anterior', case when not v_nuevo and v_antes.archivo_path is distinct from v_archivo then v_antes.archivo_path end);
end;
$$;

revoke execute on function interno.texto_valido(jsonb, integer), interno.validar_contenido_curso(jsonb) from public, anon, authenticated;
revoke execute on function public.admin_guardar_curso(uuid, jsonb), public.admin_guardar_certificacion(uuid, jsonb),
  public.admin_guardar_herramienta(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_guardar_curso(uuid, jsonb), public.admin_guardar_certificacion(uuid, jsonb),
  public.admin_guardar_herramienta(uuid, jsonb) to service_role;

-- Vistas del panel ---------------------------------------------------------------------------------------------------

create view public.v_admin_academy_cursos
with (security_invoker = true)
as
select m.codigo, m.nombre as titulo, m.escuela, m.formato, m.minutos, m.nivel, m.aliados, m.acceso, m.destacado, m.nuevo,
       m.popular, m.rapido, m.ruta, m.descripcion, m.herramienta, m.puntos, m.activo, m.orden, m.publicado, m.updated_at,
       mc.contenido,
       (select count(*) from public.modulos_completados x where x.modulo_id = m.id)::integer as completados
from public.modulos m
join public.modulos_contenido mc on mc.modulo_id = m.id
where (select interno.es_admin()) and m.escuela is not null;

create view public.v_admin_academy_certificaciones
with (security_invoker = true)
as
select c.codigo, c.nombre, c.descripcion, c.escuela, c.sigla, c.cursos, c.activa, c.orden, c.updated_at
from public.academy_certificaciones c
where (select interno.es_admin());

create view public.v_admin_academy_herramientas
with (security_invoker = true)
as
select h.codigo, h.nombre, h.categoria, h.icono, h.descripcion, h.acceso, h.archivo_path, h.archivo_nombre, h.activa, h.orden,
       h.updated_at,
       (select count(*) from public.modulos m where m.herramienta = h.codigo and m.activo)::integer as cursos
from public.academy_herramientas h
where (select interno.es_admin());

revoke all on public.v_admin_academy_cursos, public.v_admin_academy_certificaciones, public.v_admin_academy_herramientas
  from public, anon, authenticated;
grant select on public.v_admin_academy_cursos, public.v_admin_academy_certificaciones, public.v_admin_academy_herramientas
  to authenticated;

-- Los cursos de la Academy anterior (c11, c12…) se desactivan: lo ya completado se conserva en modulos_completados
-- y en el historial de puntos. El catálogo nuevo se carga en la migración academy_contenido (20261008201000).
update public.modulos set activo = false where escuela is null;
