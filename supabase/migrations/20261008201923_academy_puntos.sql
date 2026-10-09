-- Puntos Sol de la Academy (decisión del equipo, oct 2026; CLAUDE.md §4.9, §5, §5.3):
--   * tope mensual de los minicursos: 40 Puntos Sol (antes 20), porque se ampliaron los rangos de las órbitas;
--   * la masterclass da +10 (los demás minicursos siguen en +5);
--   * completar una certificación (todos sus minicursos) da +15, aparte de los puntos de cada minicurso y por fuera del
--     tope mensual de los minicursos. Una vez por aliado y certificación (clave certificacion:{id}:{aliado}).

-- Regla y vínculo nuevos ---------------------------------------------------------------------------------------------

insert into public.reglas_puntos (motivo, tipo, puntos, descripcion)
values ('certificacion_academy', 'ganado', 15, 'Certificación de la Academy');

alter table public.movimientos_puntos drop constraint movimientos_puntos_vinculo_check;
alter table public.movimientos_puntos add constraint movimientos_puntos_vinculo_check check (vinculo in (
  'empresas', 'eventos', 'modulos_completados', 'racha', 'canjes', 'ajuste_admin', 'aliados', 'academy_certificaciones'
));

alter table public.movimientos_puntos drop constraint movimientos_puntos_motivo_tipo;
alter table public.movimientos_puntos add constraint movimientos_puntos_motivo_tipo check (
  (tipo = 'ganado' and motivo in ('registro_valido', 'referido_perfecto', 'empresa_calificada', 'evaluacion_tecnica',
    'propuesta_comercial', 'negocio_cerrado', 'modulo_completado', 'evento_validado', 'racha_solar', 'ajuste_admin', 'bienvenida',
    'meddpicc', 'certificacion_academy'))
  or (tipo = 'perdido' and motivo in ('referido_imperfecto', 'referido_no_calificado', 'fuera_perfil', 'informacion_falsa',
    'baja_calidad_reiterada', 'ajuste_admin'))
  or (tipo = 'redimido' and motivo = 'canje')
);

-- Masterclass: +10 ------------------------------------------------------------------------------------------------

update public.modulos set puntos = 10 where escuela is not null and formato = 'masterclass';

-- Tope mensual de los minicursos: 40 ---------------------------------------------------------------------------------

create or replace function public.otorgar_modulos_pendientes(p_aliado uuid, p_ahora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tope      constant integer := 40;
  v_estado    text;
  v_inicio    timestamptz := date_trunc('month', p_ahora at time zone 'America/Bogota') at time zone 'America/Bogota';
  v_mes       integer;
  v_total     integer := 0;
  v_insertado integer;
  r record;
begin
  -- Bloquea al aliado: dos otorgamientos simultáneos no pueden pasarse del tope.
  select a.estado into v_estado from public.aliados a where a.id = p_aliado for update;
  if v_estado is distinct from 'activo' then
    return 0;
  end if;

  select coalesce(sum(m.puntos), 0) into v_mes
  from public.movimientos_puntos m
  where m.aliado_id = p_aliado
    and m.motivo = 'modulo_completado'
    and m.fecha >= v_inicio
    and m.fecha <= p_ahora;

  for r in
    select mc.id, mc.puntos
    from public.modulos_completados mc
    where mc.aliado_id = p_aliado
      and mc.recompensa_estado = 'pendiente'
    order by mc.fecha_completado, mc.id
  loop
    exit when v_mes + r.puntos > c_tope;

    insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, vinculo_id, clave_unica, creado_por, fecha)
    values (p_aliado, 'ganado', r.puntos, 'modulo_completado', 'modulos_completados', r.id::text,
            'modulo:' || r.id, 'sistema', p_ahora)
    on conflict (clave_unica) do nothing;
    get diagnostics v_insertado = row_count;

    update public.modulos_completados mc
    set recompensa_estado = 'otorgada', fecha_otorgada = p_ahora
    where mc.id = r.id;

    if v_insertado > 0 then
      v_mes   := v_mes + r.puntos;
      v_total := v_total + r.puntos;
    end if;
  end loop;

  return v_total;
end;
$$;


-- Certificación completa: +15 --------------------------------------------------------------------------------------

-- Otorga los +15 a quien ya completó todos los minicursos de una certificación activa. Filtra por aliado, por
-- certificación o por ambos (NULL = todos). Idempotente. Devuelve cuántos movimientos nuevos se registraron.
-- Si la cuenta no está activa, el movimiento queda retenido como los demás (§4.7).
create function interno.otorgar_certificaciones(p_aliado uuid default null, p_cert uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_n     integer;
  r record;
begin
  for r in
    select c.id as cert_id, c.nombre, a.id as aliado_id
    from public.academy_certificaciones c
    cross join public.aliados a
    where c.activa
      and (p_cert is null or c.id = p_cert)
      and (p_aliado is null or a.id = p_aliado)
      and a.rol = 'aliado'
      and cardinality(c.cursos) > 0
      and not exists (
        select 1 from unnest(c.cursos) x
        where not exists (select 1 from public.modulos_completados mc join public.modulos m on m.id = mc.modulo_id
                          where mc.aliado_id = a.id and m.codigo = x))
  loop
    insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por, nota)
    values (r.aliado_id, 'ganado', 'certificacion_academy', 'academy_certificaciones', r.cert_id::text,
            'certificacion:' || r.cert_id || ':' || r.aliado_id, 'sistema', 'Certificación: ' || r.nombre)
    on conflict (clave_unica) do nothing;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;
revoke execute on function interno.otorgar_certificaciones(uuid, uuid) from public, anon, authenticated;

-- Al completar un minicurso se revisan las certificaciones de ese aliado.
create function interno.modulos_completados_certificaciones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform interno.otorgar_certificaciones(new.aliado_id, null);
  return null;
end;
$$;
revoke execute on function interno.modulos_completados_certificaciones() from public, anon, authenticated;
create trigger modulos_completados_certificaciones
  after insert on public.modulos_completados
  for each row execute function interno.modulos_completados_certificaciones();

-- Panel: masterclass de 10 y certificaciones que otorgan los +15 a quien ya las completó ----------------------------

create or replace function public.admin_guardar_curso(p_admin uuid, p_datos jsonb)
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
  if coalesce((p_datos ->> 'puntos')::text, '') not in ('0', '5', '10') then
    raise exception 'dato_invalido: los Puntos Sol del curso son 5, 10 o 0';
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


create or replace function public.admin_guardar_certificacion(p_admin uuid, p_datos jsonb)
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

  -- Quien ya completó todos sus minicursos recibe los +15 (también al crearla o al quitarle un minicurso).
  perform interno.otorgar_certificaciones(null, (select c.id from public.academy_certificaciones c where c.codigo = v_codigo));

  perform interno.registrar_accion_admin(p_admin, v_admin, 'guardar_certificacion', null, null, 'certificacion:' || v_codigo,
    jsonb_build_object('nuevo', v_nuevo, 'nombre', btrim(p_datos ->> 'nombre'), 'cursos', cardinality(v_cursos)));
  return jsonb_build_object('codigo', v_codigo, 'nuevo', v_nuevo);
end;
$$;

-- Quien ya completó una certificación antes de esta migración recibe sus +15.
select interno.otorgar_certificaciones();
