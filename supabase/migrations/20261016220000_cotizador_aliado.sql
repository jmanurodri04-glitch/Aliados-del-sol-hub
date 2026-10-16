-- Cotizador Solar solo para aliados y Comparador de propuestas (decisión del equipo, 16 oct 2026; CLAUDE.md §7.5, §7.6).
--
--   · Solo cotiza un aliado con sesión: cada cotización guarda su aliado_id (antes las tablas no se relacionaban con
--     nada). Las filas sin aliado se borran (el equipo ya las borró a mano en dev y prod; esto es la red de seguridad
--     para las que entren antes de publicar).
--   · El nombre de la empresa (comercial e industrial) o el nombre en residencial es único POR ALIADO, entre las tres
--     tablas: es lo que el aliado elige en el Comparador. Se compara sin mayúsculas, tildes ni espacios dobles. No tiene
--     relación con la tabla empresas (referidos): cotizar una empresa nunca impide referirla, ni al revés.
--   · Mientras no se solicite la propuesta, volver a «Conectar al inversor» actualiza la misma fila (antes creaba otra).
--   · «Solicitar propuesta» da +5 Puntos Sol (uso_cotizador), una vez por cotización y sin tope; el equipo descuenta
--     con ajuste_admin si ve abuso. Los puntos por las fases del negocio solo llegan por «Referir empresa».
--   · Las respuestas MEDDPICC (7 preguntas que piden la descarga del PDF) se guardan en la cotización.
--   · Se retiran el «Email de quien refiere» y el código temporal de quien refiere (referente_codigo): el aliado sale
--     de la sesión y el cotizador ya no lleva ID_aliado a Clientify.
--   · «Borrar lo descargado» del panel solo borra cotizaciones de más de 12 meses (el aliado las usa en el Comparador).

-- Red de seguridad: ninguna cotización sin aliado (hoy las tablas no tienen la columna, así que son todas).
delete from public.cotizador_residencial;
delete from public.cotizador_comercial;
delete from public.cotizador_industrial;
delete from public.cotizador_intentos;

-- Nombre comparable: minúsculas, sin tildes ni espacios repetidos. Inmutable para usarlo en columnas generadas.
create function interno.cotizador_normalizar(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(translate(lower(coalesce(p_texto, '')), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc'), '\s+', ' ', 'g')), '');
$$;

-- Columnas nuevas ------------------------------------------------------------------------------------------------------

alter table public.cotizador_residencial
  drop column referente_codigo,
  add column aliado_id uuid not null references public.aliados (id) on delete cascade,
  add column nombre_normalizado text generated always as (interno.cotizador_normalizar(nombre)) stored,
  add column meddpicc jsonb check (meddpicc is null or (jsonb_typeof(meddpicc) = 'object' and pg_column_size(meddpicc) < 6000)),
  add column meddpicc_at timestamptz,
  add column actualizada_at timestamptz;
alter table public.cotizador_comercial
  drop column referente_codigo,
  add column aliado_id uuid not null references public.aliados (id) on delete cascade,
  add column nombre_normalizado text generated always as (interno.cotizador_normalizar(empresa)) stored,
  add column meddpicc jsonb check (meddpicc is null or (jsonb_typeof(meddpicc) = 'object' and pg_column_size(meddpicc) < 6000)),
  add column meddpicc_at timestamptz,
  add column actualizada_at timestamptz;
alter table public.cotizador_industrial
  drop column referente_codigo,
  add column aliado_id uuid not null references public.aliados (id) on delete cascade,
  add column nombre_normalizado text generated always as (interno.cotizador_normalizar(empresa)) stored,
  add column meddpicc jsonb check (meddpicc is null or (jsonb_typeof(meddpicc) = 'object' and pg_column_size(meddpicc) < 6000)),
  add column meddpicc_at timestamptz,
  add column actualizada_at timestamptz;

-- Único por aliado dentro de cada tabla (entre tablas lo revisa cotizador_guardar_simulacion con un bloqueo por aliado).
create unique index cotizador_residencial_nombre on public.cotizador_residencial (aliado_id, nombre_normalizado);
create unique index cotizador_comercial_nombre on public.cotizador_comercial (aliado_id, nombre_normalizado);
create unique index cotizador_industrial_nombre on public.cotizador_industrial (aliado_id, nombre_normalizado);
create index cotizador_residencial_aliado on public.cotizador_residencial (aliado_id, created_at desc);
create index cotizador_comercial_aliado on public.cotizador_comercial (aliado_id, created_at desc);
create index cotizador_industrial_aliado on public.cotizador_industrial (aliado_id, created_at desc);

comment on table public.cotizador_residencial is 'Cotizador Solar: cotizaciones residenciales de los aliados (nombre único por aliado; las usa el Comparador de propuestas).';
comment on table public.cotizador_comercial is 'Cotizador Solar: cotizaciones comerciales de los aliados (empresa única por aliado; las usa el Comparador de propuestas).';
comment on table public.cotizador_industrial is 'Cotizador Solar: cotizaciones industriales de los aliados (empresa única por aliado; las usa el Comparador de propuestas).';

-- Puntos: +5 por solicitar la propuesta --------------------------------------------------------------------------------

insert into public.reglas_puntos (motivo, tipo, puntos, descripcion)
values ('uso_cotizador', 'ganado', 5, 'Uso del Cotizador Solar');

alter table public.movimientos_puntos drop constraint movimientos_puntos_vinculo_check;
alter table public.movimientos_puntos add constraint movimientos_puntos_vinculo_check check (vinculo in (
  'empresas', 'eventos', 'modulos_completados', 'racha', 'canjes', 'ajuste_admin', 'aliados', 'academy_certificaciones', 'cotizador'
));

alter table public.movimientos_puntos drop constraint movimientos_puntos_motivo_tipo;
alter table public.movimientos_puntos add constraint movimientos_puntos_motivo_tipo check (
  (tipo = 'ganado' and motivo in ('registro_valido', 'referido_perfecto', 'empresa_calificada', 'evaluacion_tecnica',
    'propuesta_comercial', 'negocio_cerrado', 'modulo_completado', 'evento_validado', 'racha_solar', 'ajuste_admin', 'bienvenida',
    'meddpicc', 'certificacion_academy', 'uso_cotizador'))
  or (tipo = 'perdido' and motivo in ('referido_imperfecto', 'referido_no_calificado', 'fuera_perfil', 'informacion_falsa',
    'baja_calidad_reiterada', 'ajuste_admin'))
  or (tipo = 'redimido' and motivo = 'canje')
);

-- Funciones del servidor -----------------------------------------------------------------------------------------------

-- Lanza aliado_no_activo si la cuenta no es de un aliado activo (el servidor ya lo revisa con la sesión).
create function interno.cotizador_exigir_aliado(p_aliado uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from public.aliados a where a.id = p_aliado and a.rol = 'aliado' and a.estado = 'activo') then
    raise exception 'aliado_no_activo: el cotizador es solo para aliados activos';
  end if;
end;
$$;

-- ¿El aliado ya usa ese nombre en alguna de sus cotizaciones (de cualquier tipo)? p_excluir: la que se está editando.
create function interno.cotizador_nombre_usado(p_aliado uuid, p_nombre_normalizado text, p_excluir uuid default null)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.cotizador_residencial c where c.aliado_id = p_aliado and c.nombre_normalizado = p_nombre_normalizado and c.id is distinct from p_excluir)
      or exists (select 1 from public.cotizador_comercial c where c.aliado_id = p_aliado and c.nombre_normalizado = p_nombre_normalizado and c.id is distinct from p_excluir)
      or exists (select 1 from public.cotizador_industrial c where c.aliado_id = p_aliado and c.nombre_normalizado = p_nombre_normalizado and c.id is distinct from p_excluir);
$$;

-- Paso 2: ¿el nombre está libre para este aliado? p_excluir: la cotización que se está editando (su propio nombre).
create function public.cotizador_nombre_disponible(p_aliado uuid, p_nombre text, p_excluir uuid default null)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_nombre text := interno.cotizador_normalizar(p_nombre);
begin
  if v_nombre is null then
    raise exception 'dato_invalido: falta el nombre';
  end if;
  return not interno.cotizador_nombre_usado(p_aliado, v_nombre, p_excluir);
end;
$$;

-- «Conectar al inversor»: guarda la cotización del aliado. Con p_id de una cotización suya que aún no pidió propuesta,
-- la actualiza (mismo id y mismo nombre si no lo cambió); si no, crea una nueva. p_fila trae los datos ya validados y
-- los resultados recalculados por /api/cotizador. Error nombre_repetido si el aliado ya usa ese nombre en otra.
drop function public.cotizador_registrar_simulacion(text, jsonb);
create function public.cotizador_guardar_simulacion(p_aliado uuid, p_segmento text, p_fila jsonb, p_id uuid default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tabla    text := interno.cotizador_tabla(p_segmento);
  v_comun    text := 'telefono, correo, ciudad, departamento, region, unidad, consumo_kwh_mes, valor_factura_cop, conectado_red, '
                  || 'almacenamiento, potencia_kwp, modulos, inversores, generacion_kwh_mes, cobertura_pct, ahorro_anual_cop, '
                  || 'payback_anios, co2_t_anio, almacenamiento_kwh, area_minima_m2, inversion_total_cop';
  v_propias  text := case when p_segmento = 'residencial' then 'nombre' else 'empresa, contacto, subsector' end;
  v_nombre   text;
  v_editable boolean := false;
  v_id       uuid;
begin
  perform interno.cotizador_exigir_aliado(p_aliado);
  if p_fila is null or jsonb_typeof(p_fila) <> 'object' then
    raise exception 'dato_invalido: faltan los datos de la simulación';
  end if;
  v_nombre := interno.cotizador_normalizar(p_fila ->> case when p_segmento = 'residencial' then 'nombre' else 'empresa' end);
  if v_nombre is null then
    raise exception 'dato_invalido: falta el nombre';
  end if;
  -- Un aliado a la vez: dos pestañas no pueden quedarse con el mismo nombre.
  perform pg_advisory_xact_lock(hashtextextended('cotizador:' || p_aliado::text, 0));

  if p_id is not null then
    execute format('select true from public.%I c where c.id = $1 and c.aliado_id = $2 and c.propuesta_solicitada_at is null for update', v_tabla)
      into v_editable using p_id, p_aliado;
    v_editable := coalesce(v_editable, false);
  end if;
  if interno.cotizador_nombre_usado(p_aliado, v_nombre, case when v_editable then p_id end) then
    raise exception 'nombre_repetido: ya tienes una cotización con ese nombre';
  end if;

  if v_editable then
    execute format(
      'update public.%1$I t set (%2$s, %3$s) = (select %2$s, %3$s from jsonb_populate_record(null::public.%1$I, $2)), '
      || 'actualizada_at = now(), politica_datos_version = interno.version_politica_datos_vigente(), autorizacion_datos_at = now() '
      || 'where t.id = $1',
      v_tabla, v_propias, v_comun)
    using p_id, p_fila;
    return p_id;
  end if;

  v_id := gen_random_uuid();
  -- Solo se toman las columnas de datos; id, aliado, fechas, versión de la política y estado de Clientify los pone la base.
  execute format(
    'insert into public.%1$I (id, aliado_id, politica_datos_version, %2$s, %3$s) '
    || 'select $1, $3, interno.version_politica_datos_vigente(), %2$s, %3$s from jsonb_populate_record(null::public.%1$I, $2)',
    v_tabla, v_propias, v_comun)
  using v_id, p_fila, p_aliado;
  return v_id;
end;
$$;

-- «Solicitar propuesta»: marca la cotización del aliado y la pone en la cola de Clientify (solo el día en que se
-- simuló). La primera vez da +5 Puntos Sol (uso_cotizador). Repetirla no duplica nada. Devuelve { estado, puntos }.
drop function public.cotizador_solicitar_propuesta(text, uuid, text);
drop function public.cotizador_codigo_referente(text);
create function public.cotizador_solicitar_propuesta(p_aliado uuid, p_segmento text, p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tabla  text := interno.cotizador_tabla(p_segmento);
  v_estado text;
  v_existe boolean;
  v_puntos integer := 0;
begin
  perform interno.cotizador_exigir_aliado(p_aliado);
  execute format('select true, clientify_sync_estado from public.%I where id = $1 and aliado_id = $2 and created_at > now() - interval ''1 day'' for update', v_tabla)
    into v_existe, v_estado using p_id, p_aliado;
  if v_existe is null then
    raise exception 'simulacion_inexistente: la simulación no existe o ya venció';
  end if;
  if v_estado is null then
    execute format('update public.%I set propuesta_solicitada_at = now(), clientify_sync_estado = ''pendiente'', '
                   || 'clientify_sync_proximo_at = now() where id = $1', v_tabla) using p_id;
    v_estado := 'pendiente';
    insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por)
    values (p_aliado, 'ganado', 'uso_cotizador', 'cotizador', p_id::text, 'cotizacion:' || p_segmento || ':' || p_id, 'sistema')
    on conflict (clave_unica) do nothing;
    if found then
      select r.puntos into v_puntos from public.reglas_puntos r where r.motivo = 'uso_cotizador';
    end if;
  end if;
  return jsonb_build_object('estado', v_estado, 'puntos', coalesce(v_puntos, 0));
end;
$$;

-- Respuestas MEDDPICC de una cotización del aliado (las valida /api/cotizador con js/cotizador-meddpicc.js).
create function public.cotizador_guardar_meddpicc(p_aliado uuid, p_segmento text, p_id uuid, p_respuestas jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tabla text := interno.cotizador_tabla(p_segmento);
  v_filas integer;
begin
  perform interno.cotizador_exigir_aliado(p_aliado);
  if p_respuestas is null or jsonb_typeof(p_respuestas) <> 'object' or jsonb_typeof(p_respuestas -> 'respuestas') is distinct from 'object' then
    raise exception 'dato_invalido: faltan las respuestas';
  end if;
  execute format('update public.%I set meddpicc = $3, meddpicc_at = now() where id = $1 and aliado_id = $2', v_tabla)
    using p_id, p_aliado, p_respuestas;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'simulacion_inexistente: la cotización no existe';
  end if;
end;
$$;

-- Cotizaciones del aliado para el Comparador de propuestas: solo los datos que necesita (sin teléfono ni correo).
create function public.cotizador_mis_cotizaciones(p_aliado uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
  from (
    select c.id, 'residencial'::text as segmento, c.nombre, c.created_at, c.propuesta_solicitada_at, c.ciudad, c.departamento,
           c.conectado_red, c.almacenamiento, c.consumo_kwh_mes, c.potencia_kwp, c.modulos, c.generacion_kwh_mes, c.inversion_total_cop
    from public.cotizador_residencial c where c.aliado_id = p_aliado
    union all
    select c.id, 'comercial', c.empresa, c.created_at, c.propuesta_solicitada_at, c.ciudad, c.departamento,
           c.conectado_red, c.almacenamiento, c.consumo_kwh_mes, c.potencia_kwp, c.modulos, c.generacion_kwh_mes, c.inversion_total_cop
    from public.cotizador_comercial c where c.aliado_id = p_aliado
    union all
    select c.id, 'industrial', c.empresa, c.created_at, c.propuesta_solicitada_at, c.ciudad, c.departamento,
           c.conectado_red, c.almacenamiento, c.consumo_kwh_mes, c.potencia_kwp, c.modulos, c.generacion_kwh_mes, c.inversion_total_cop
    from public.cotizador_industrial c where c.aliado_id = p_aliado
    order by created_at desc
    limit 300
  ) x;
$$;

-- Cola de Clientify: igual que antes, con el código del aliado (para la descripción del contacto; no va a ID_aliado)
-- y sin el aliado_id interno, que nunca sale de la base.
create or replace function public.cotizador_reclamar_propuestas(p_limite integer default 10, p_segmento text default null, p_id uuid default null)
returns setof jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_seg    text;
  v_limite integer := greatest(1, least(coalesce(p_limite, 10), 50));
begin
  foreach v_seg in array array['residencial', 'comercial', 'industrial'] loop
    continue when p_segmento is not null and p_segmento <> v_seg;
    return query execute format(
      'with elegidas as ('
      || '  select c.id from public.%1$I c'
      || '  where c.clientify_sync_estado in (''pendiente'', ''error'') and c.clientify_sync_proximo_at <= now()'
      || '    and ($2::uuid is null or c.id = $2)'
      || '  order by c.clientify_sync_proximo_at limit $1 for update of c skip locked) '
      || 'update public.%1$I c set clientify_sync_proximo_at = now() + interval ''10 minutes'' '
      || 'from elegidas x where c.id = x.id '
      || 'returning (to_jsonb(c) - ''aliado_id'' - ''nombre_normalizado'') || jsonb_build_object(''segmento'', %2$L, '
      || '  ''codigo_aliado'', (select a.codigo_aliado from public.aliados a where a.id = c.aliado_id))',
      interno.cotizador_tabla(v_seg), v_seg)
    using v_limite, p_id;
  end loop;
end;
$$;

-- Resultado del envío: igual que la versión original (ya no hay código de quien refiere que borrar).
create or replace function public.cotizador_resultado_propuesta(p_segmento text, p_id uuid, p_contact_id text, p_error text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'update public.%I c set '
    || '  clientify_sync_estado = case when $3 is null then ''ok'' else ''error'' end, '
    || '  clientify_contact_id  = coalesce($2, c.clientify_contact_id), '
    || '  clientify_sync_error  = left($3, 300), '
    || '  clientify_sync_at     = case when $3 is null then now() else c.clientify_sync_at end, '
    || '  clientify_sync_intentos = c.clientify_sync_intentos + case when $3 is null then 0 else 1 end, '
    || '  clientify_sync_proximo_at = case when $3 is null then null '
    || '    when c.clientify_sync_intentos + 1 >= 8 then ''infinity''::timestamptz '
    || '    else now() + least(interval ''15 minutes'' * power(2, c.clientify_sync_intentos), interval ''6 hours'') end '
    || 'where c.id = $1 and c.clientify_sync_estado in (''pendiente'', ''error'')',
    interno.cotizador_tabla(p_segmento))
  using p_id, p_contact_id, p_error;
end;
$$;

-- Panel de administración ----------------------------------------------------------------------------------------------

-- «Borrar lo descargado»: solo cotizaciones de más de 12 meses dentro del rango (decisión del equipo, 16 oct 2026),
-- y nunca propuestas que aún no llegan a Clientify.
create or replace function public.admin_cotizador_borrar(p_admin uuid, p_segmento text, p_desde timestamptz, p_hasta timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin     text := interno.exigir_admin(p_admin);
  v_tabla     text := interno.cotizador_tabla(p_segmento);
  v_corte     timestamptz;
  v_borradas  integer := 0;
  v_retenidas integer;
  v_recientes integer;
begin
  if p_desde is null or p_hasta is null or p_hasta <= p_desde then
    raise exception 'dato_invalido: el rango de fechas no es válido';
  end if;
  v_corte := least(p_hasta, now() - interval '12 months');
  if v_corte > p_desde then
    execute format('with b as (delete from public.%I c where c.created_at >= $1 and c.created_at < $2 '
                   || 'and (c.clientify_sync_estado is null or c.clientify_sync_estado = ''ok'') returning 1) select count(*) from b', v_tabla)
      into v_borradas using p_desde, v_corte;
  end if;
  execute format('select count(*) filter (where c.created_at < $3), count(*) filter (where c.created_at >= $3) '
                 || 'from public.%I c where c.created_at >= $1 and c.created_at < $2', v_tabla)
    into v_retenidas, v_recientes using p_desde, p_hasta, greatest(v_corte, p_desde);
  perform interno.registrar_accion_admin(p_admin, v_admin, 'borrar_cotizaciones', null, null, 'cotizador:' || p_segmento,
    jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'corte', v_corte, 'borradas', v_borradas, 'sin_enviar', v_retenidas, 'recientes', v_recientes));
  return jsonb_build_object('borradas', v_borradas, 'sin_enviar', v_retenidas, 'recientes', v_recientes);
end;
$$;

-- Uso del cotizador por aliado: para que el equipo vea un uso exagerado y descuente puntos si hace falta.
create view public.v_admin_cotizador_aliados
with (security_invoker = true) as
with c as (
  select aliado_id, created_at, propuesta_solicitada_at from public.cotizador_residencial
  union all select aliado_id, created_at, propuesta_solicitada_at from public.cotizador_comercial
  union all select aliado_id, created_at, propuesta_solicitada_at from public.cotizador_industrial
)
select a.codigo_aliado, a.nombre_completo,
       count(*) as cotizaciones,
       count(*) filter (where c.created_at > now() - interval '7 days') as cotizaciones_7d,
       count(*) filter (where c.created_at > now() - interval '30 days') as cotizaciones_30d,
       count(c.propuesta_solicitada_at) as solicitudes,
       count(*) filter (where c.propuesta_solicitada_at > now() - interval '30 days') as solicitudes_30d,
       (select coalesce(sum(m.puntos_aplicados), 0) from public.movimientos_puntos m where m.aliado_id = a.id and m.motivo = 'uso_cotizador') as puntos_cotizador,
       max(c.created_at) as ultima
from c
join public.aliados a on a.id = c.aliado_id
where (select interno.es_admin())
group by a.id, a.codigo_aliado, a.nombre_completo
order by count(*) filter (where c.created_at > now() - interval '30 days') desc, max(c.created_at) desc;

revoke all on public.v_admin_cotizador_aliados from anon;
grant select on public.v_admin_cotizador_aliados to authenticated;

-- Permisos: solo service_role ejecuta (las llaman /api/cotizador, el cron y /api/admin con la clave secreta).
revoke execute on function interno.cotizador_normalizar(text) from public, anon, authenticated;
revoke execute on function interno.cotizador_exigir_aliado(uuid) from public, anon, authenticated;
revoke execute on function interno.cotizador_nombre_usado(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.cotizador_nombre_disponible(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.cotizador_guardar_simulacion(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.cotizador_solicitar_propuesta(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.cotizador_guardar_meddpicc(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.cotizador_mis_cotizaciones(uuid) from public, anon, authenticated;
grant execute on function interno.cotizador_normalizar(text) to service_role, authenticated;
grant execute on function interno.cotizador_exigir_aliado(uuid) to service_role;
grant execute on function interno.cotizador_nombre_usado(uuid, text, uuid) to service_role;
grant execute on function public.cotizador_nombre_disponible(uuid, text, uuid) to service_role;
grant execute on function public.cotizador_guardar_simulacion(uuid, text, jsonb, uuid) to service_role;
grant execute on function public.cotizador_solicitar_propuesta(uuid, text, uuid) to service_role;
grant execute on function public.cotizador_guardar_meddpicc(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.cotizador_mis_cotizaciones(uuid) to service_role;
