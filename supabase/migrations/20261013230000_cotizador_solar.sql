-- Cotizador Solar (Herramientas del Hub y sitio público), oct 2026.
--
-- Decisiones del equipo:
--   · Cualquiera puede usar el cotizador, con o sin sesión. Está APARTE del programa de puntos: no guarda el aliado,
--     no da Puntos Sol y sus tablas no se relacionan con ninguna otra.
--   · Una tabla por tipo de proyecto (residencial, comercial, industrial). Son para análisis de marketing: se
--     descargan cada 6 a 12 meses desde el panel (CSV) y después se pueden borrar.
--   · «Conectar al inversor» guarda una fila: los datos de contacto, lo que escribió la persona y los resultados del
--     diseño (el servidor los recalcula con js/cotizador-calculo.js, no confía en el navegador). La financiación no
--     se guarda.
--   · «Solicitar propuesta» marca la fila y la pone en la cola de Clientify (contacto con la etiqueta «Cotizador Hub»,
--     sin oportunidad ni aviso al equipo). La procesa /api/cotizador enseguida y, si falla, el cron de Clientify.
--   · Abuso: captcha y un máximo de intentos por hora por conexión (huella HMAC de la IP; la IP nunca se guarda).
--
-- Solo el servidor (service_role) escribe. Un admin lee las tablas (RLS) para descargarlas y borra con
-- admin_cotizador_borrar, que queda en acciones_admin.


-- Tablas --------------------------------------------------------------------------------------------------------------

-- Columnas comunes: se repiten en las tres tablas (no hay tabla padre: el equipo las quiere independientes).
create table public.cotizador_residencial (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  nombre                    text not null check (char_length(nombre) between 2 and 200),
  telefono                  text not null check (telefono ~ '^\+[1-9][0-9]{6,14}$' and (telefono !~ '^\+57' or telefono ~ '^\+573[0-9]{9}$')),
  correo                    text not null check (char_length(correo) <= 200 and correo ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  ciudad                    text not null check (char_length(ciudad) between 1 and 100),
  departamento              text not null check (char_length(departamento) between 1 and 100),
  region                    text not null check (region in ('Costa', 'Centro', 'Oriente')),
  unidad                    text not null check (unidad in ('kwh', 'cop')),
  consumo_kwh_mes           numeric not null check (consumo_kwh_mes > 0),
  valor_factura_cop         numeric not null check (valor_factura_cop > 0),
  conectado_red             boolean not null,
  almacenamiento            text not null check (almacenamiento in ('none', 'respaldo', 'autonomia', 'extendida')),
  potencia_kwp              numeric not null check (potencia_kwp >= 0),
  modulos                   integer not null check (modulos >= 0),
  inversores                integer not null check (inversores >= 0),
  generacion_kwh_mes        numeric not null check (generacion_kwh_mes >= 0),
  cobertura_pct             numeric not null check (cobertura_pct >= 0),
  ahorro_anual_cop          numeric check (ahorro_anual_cop >= 0),        -- NULL en un sistema aislado (no se muestra)
  payback_anios             numeric check (payback_anios >= 0),           -- NULL en un sistema aislado
  co2_t_anio                numeric not null check (co2_t_anio >= 0),
  almacenamiento_kwh        numeric not null check (almacenamiento_kwh >= 0),
  area_minima_m2            numeric not null check (area_minima_m2 >= 0),
  inversion_total_cop       numeric not null check (inversion_total_cop >= 0),
  autorizacion_datos_at     timestamptz not null default now(),
  politica_datos_version    text not null,
  propuesta_solicitada_at   timestamptz,
  clientify_contact_id      text,
  clientify_sync_estado     text check (clientify_sync_estado in ('pendiente', 'ok', 'error')),   -- NULL: sin propuesta
  clientify_sync_error      text,
  clientify_sync_intentos   integer not null default 0,
  clientify_sync_proximo_at timestamptz,
  clientify_sync_at         timestamptz,
  check ((propuesta_solicitada_at is null) = (clientify_sync_estado is null))
);

-- Comercial e industrial piden los datos de la empresa en lugar del nombre de la persona.
create table public.cotizador_comercial (like public.cotizador_residencial including defaults including constraints);
alter table public.cotizador_comercial
  drop column nombre,
  add column empresa   text not null check (char_length(empresa) between 2 and 200),
  add column contacto  text not null check (char_length(contacto) between 2 and 200),
  add column subsector text not null check (char_length(subsector) between 2 and 100),
  add primary key (id);

create table public.cotizador_industrial (like public.cotizador_comercial including defaults including constraints);
alter table public.cotizador_industrial add primary key (id);

comment on table public.cotizador_residencial is 'Cotizador Solar: simulaciones de proyectos residenciales (marketing; se descargan y se borran). Sin relación con el programa de puntos.';
comment on table public.cotizador_comercial is 'Cotizador Solar: simulaciones de proyectos comerciales (marketing; se descargan y se borran). Sin relación con el programa de puntos.';
comment on table public.cotizador_industrial is 'Cotizador Solar: simulaciones de proyectos industriales (marketing; se descargan y se borran). Sin relación con el programa de puntos.';

create index cotizador_residencial_created_at on public.cotizador_residencial (created_at);
create index cotizador_comercial_created_at on public.cotizador_comercial (created_at);
create index cotizador_industrial_created_at on public.cotizador_industrial (created_at);
create index cotizador_residencial_cola on public.cotizador_residencial (clientify_sync_proximo_at) where clientify_sync_estado in ('pendiente', 'error');
create index cotizador_comercial_cola on public.cotizador_comercial (clientify_sync_proximo_at) where clientify_sync_estado in ('pendiente', 'error');
create index cotizador_industrial_cola on public.cotizador_industrial (clientify_sync_proximo_at) where clientify_sync_estado in ('pendiente', 'error');

-- Intentos por conexión en la ventana de una hora (una fila por huella, sin historial).
create table public.cotizador_intentos (
  huella          text primary key,
  ventana_inicio  timestamptz not null default now(),
  intentos        integer not null default 1 check (intentos >= 0)
);
comment on table public.cotizador_intentos is 'Cotizador Solar: intentos por conexión en la ventana de una hora (límite anti-abuso).';

alter table public.cotizador_residencial enable row level security;
alter table public.cotizador_comercial enable row level security;
alter table public.cotizador_industrial enable row level security;
alter table public.cotizador_intentos enable row level security;

revoke all on table public.cotizador_residencial, public.cotizador_comercial, public.cotizador_industrial,
  public.cotizador_intentos from anon, authenticated;
grant all on table public.cotizador_residencial, public.cotizador_comercial, public.cotizador_industrial,
  public.cotizador_intentos to service_role;

-- Un admin las lee desde el panel para descargarlas (las borra con admin_cotizador_borrar).
grant select on table public.cotizador_residencial, public.cotizador_comercial, public.cotizador_industrial to authenticated;
create policy cotizador_residencial_admin on public.cotizador_residencial for select to authenticated using ((select interno.es_admin()));
create policy cotizador_comercial_admin on public.cotizador_comercial for select to authenticated using ((select interno.es_admin()));
create policy cotizador_industrial_admin on public.cotizador_industrial for select to authenticated using ((select interno.es_admin()));

-- Funciones del servidor -------------------------------------------------------------------------------------------------

create function interno.cotizador_tabla(p_segmento text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_segmento in ('residencial', 'comercial', 'industrial') then
    return 'cotizador_' || p_segmento;
  end if;
  raise exception 'dato_invalido: tipo de proyecto inválido';
end;
$$;

-- Cuenta un intento y dice si la conexión sigue dentro del límite de la hora.
create function public.cotizador_intento(p_huella text, p_limite integer default 30)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_intentos integer;
begin
  if p_huella is null or p_huella !~ '^[0-9a-f]{64}$' then
    raise exception 'dato_invalido: huella inválida';
  end if;
  insert into public.cotizador_intentos as i (huella) values (p_huella)
  on conflict (huella) do update
    set ventana_inicio = case when i.ventana_inicio <= now() - interval '1 hour' then now() else i.ventana_inicio end,
        intentos       = case when i.ventana_inicio <= now() - interval '1 hour' then 1 else i.intentos + 1 end
  returning i.intentos into v_intentos;
  return v_intentos <= greatest(coalesce(p_limite, 30), 1);
end;
$$;

-- Guarda una simulación («Conectar al inversor»). p_fila trae los datos ya validados y los resultados recalculados
-- por /api/cotizador; las restricciones de la tabla vuelven a revisar el formato. Devuelve el id de la fila.
create function public.cotizador_registrar_simulacion(p_segmento text, p_fila jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tabla text := interno.cotizador_tabla(p_segmento);
  v_id    uuid := gen_random_uuid();
  v_comun text := 'telefono, correo, ciudad, departamento, region, unidad, consumo_kwh_mes, valor_factura_cop, conectado_red, '
               || 'almacenamiento, potencia_kwp, modulos, inversores, generacion_kwh_mes, cobertura_pct, ahorro_anual_cop, '
               || 'payback_anios, co2_t_anio, almacenamiento_kwh, area_minima_m2, inversion_total_cop';
  v_propias text := case when p_segmento = 'residencial' then 'nombre' else 'empresa, contacto, subsector' end;
begin
  if p_fila is null or jsonb_typeof(p_fila) <> 'object' then
    raise exception 'dato_invalido: faltan los datos de la simulación';
  end if;
  -- Solo se toman las columnas de datos; id, fechas, versión de la política y estado de Clientify los pone la base.
  execute format(
    'insert into public.%1$I (id, politica_datos_version, %2$s, %3$s) '
    || 'select $1, interno.version_politica_datos_vigente(), %2$s, %3$s from jsonb_populate_record(null::public.%1$I, $2)',
    v_tabla, v_propias, v_comun)
  using v_id, p_fila;
  return v_id;
end;
$$;

-- «Solicitar propuesta»: marca la simulación y la pone en la cola de Clientify. Solo sirve el mismo día en que se
-- simuló (el id lo tiene solo quien la hizo). Repetirla no la duplica.
create function public.cotizador_solicitar_propuesta(p_segmento text, p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tabla  text := interno.cotizador_tabla(p_segmento);
  v_estado text;
  v_existe boolean;
begin
  execute format('select true, clientify_sync_estado from public.%I where id = $1 and created_at > now() - interval ''1 day'' for update', v_tabla)
    into v_existe, v_estado using p_id;
  if v_existe is null then
    raise exception 'simulacion_inexistente: la simulación no existe o ya venció';
  end if;
  if v_estado is null then
    execute format('update public.%I set propuesta_solicitada_at = now(), clientify_sync_estado = ''pendiente'', '
                   || 'clientify_sync_proximo_at = now() where id = $1', v_tabla) using p_id;
    v_estado := 'pendiente';
  end if;
  return jsonb_build_object('estado', v_estado);
end;
$$;

-- Cola de Clientify: toma propuestas pendientes (o con error cuya espera se cumplió) con un préstamo de 10 minutos.
-- p_segmento y p_id sirven para procesar una sola enseguida.
create function public.cotizador_reclamar_propuestas(p_limite integer default 10, p_segmento text default null, p_id uuid default null)
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
      || 'returning to_jsonb(c) || jsonb_build_object(''segmento'', %2$L)',
      interno.cotizador_tabla(v_seg), v_seg)
    using v_limite, p_id;
  end loop;
end;
$$;

-- Resultado del envío a Clientify: éxito, o reintento a los 15 min, 30, 1 h… (máximo 6 h; tras 8 intentos se deja
-- de reintentar sola).
create function public.cotizador_resultado_propuesta(p_segmento text, p_id uuid, p_contact_id text, p_error text)
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

-- Panel de administración --------------------------------------------------------------------------------------------

alter table public.acciones_admin
  drop constraint acciones_admin_accion_check,
  add constraint acciones_admin_accion_check check (accion in (
    'aprobar_aliado', 'rechazar_aliado', 'suspender_aliado', 'reactivar_aliado',
    'ajuste_puntos', 'baja_calidad', 'validar_evento', 'rechazar_evento', 'resolver_conflicto',
    'anular_canje', 'guardar_recompensa', 'invitar_operador', 'estado_operador', 'eliminar_operador',
    'otorgar_meddpicc', 'reintentar_correo', 'reintentar_aviso_n8n',
    'guardar_curso', 'guardar_certificacion', 'guardar_herramienta',
    'borrar_cotizaciones'));

-- Borra las simulaciones de un tipo creadas entre dos fechas (lo que el equipo ya descargó). No borra las propuestas
-- que aún no llegan a Clientify (pendiente o error), para no perder una solicitud.
create function public.admin_cotizador_borrar(p_admin uuid, p_segmento text, p_desde timestamptz, p_hasta timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin    text := interno.exigir_admin(p_admin);
  v_tabla    text := interno.cotizador_tabla(p_segmento);
  v_borradas integer;
  v_retenidas integer;
begin
  if p_desde is null or p_hasta is null or p_hasta <= p_desde then
    raise exception 'dato_invalido: el rango de fechas no es válido';
  end if;
  execute format('with b as (delete from public.%I c where c.created_at >= $1 and c.created_at < $2 '
                 || 'and (c.clientify_sync_estado is null or c.clientify_sync_estado = ''ok'') returning 1) select count(*) from b', v_tabla)
    into v_borradas using p_desde, p_hasta;
  execute format('select count(*) from public.%I c where c.created_at >= $1 and c.created_at < $2', v_tabla)
    into v_retenidas using p_desde, p_hasta;
  perform interno.registrar_accion_admin(p_admin, v_admin, 'borrar_cotizaciones', null, null, 'cotizador:' || p_segmento,
    jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'borradas', v_borradas, 'sin_enviar', v_retenidas));
  return jsonb_build_object('borradas', v_borradas, 'sin_enviar', v_retenidas);
end;
$$;

-- Resumen para el panel: cuántas simulaciones hay de cada tipo, cuántas pidieron propuesta y cuántas no llegaron
-- a Clientify. Sin datos personales.
create view public.v_admin_cotizador
with (security_invoker = true) as
select x.segmento, x.simulaciones, x.propuestas, x.sin_enviar, x.primera, x.ultima
from (
  select 'residencial'::text as segmento, count(*) as simulaciones, count(propuesta_solicitada_at) as propuestas,
         count(*) filter (where clientify_sync_estado in ('pendiente', 'error')) as sin_enviar,
         min(created_at) as primera, max(created_at) as ultima, 3 as orden
  from public.cotizador_residencial
  union all
  select 'comercial', count(*), count(propuesta_solicitada_at), count(*) filter (where clientify_sync_estado in ('pendiente', 'error')),
         min(created_at), max(created_at), 2
  from public.cotizador_comercial
  union all
  select 'industrial', count(*), count(propuesta_solicitada_at), count(*) filter (where clientify_sync_estado in ('pendiente', 'error')),
         min(created_at), max(created_at), 1
  from public.cotizador_industrial
) x
where (select interno.es_admin())
order by x.orden;

revoke all on public.v_admin_cotizador from anon;
grant select on public.v_admin_cotizador to authenticated;

-- Permisos: solo service_role ejecuta (las llaman /api/cotizador, el cron y /api/admin con la clave secreta).
revoke execute on function interno.cotizador_tabla(text) from public, anon, authenticated;
revoke execute on function public.cotizador_intento(text, integer) from public, anon, authenticated;
revoke execute on function public.cotizador_registrar_simulacion(text, jsonb) from public, anon, authenticated;
revoke execute on function public.cotizador_solicitar_propuesta(text, uuid) from public, anon, authenticated;
revoke execute on function public.cotizador_reclamar_propuestas(integer, text, uuid) from public, anon, authenticated;
revoke execute on function public.cotizador_resultado_propuesta(text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_cotizador_borrar(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function interno.cotizador_tabla(text) to service_role;
grant execute on function interno.version_politica_datos_vigente() to service_role;
grant execute on function public.cotizador_intento(text, integer) to service_role;
grant execute on function public.cotizador_registrar_simulacion(text, jsonb) to service_role;
grant execute on function public.cotizador_solicitar_propuesta(text, uuid) to service_role;
grant execute on function public.cotizador_reclamar_propuestas(integer, text, uuid) to service_role;
grant execute on function public.cotizador_resultado_propuesta(text, uuid, text, text) to service_role;
grant execute on function public.admin_cotizador_borrar(uuid, text, timestamptz, timestamptz) to service_role;
