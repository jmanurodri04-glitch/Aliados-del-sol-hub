-- Fase 7 · 02 — Módulos de Academy y su recompensa (CLAUDE.md §4.9, §5.3).
--
-- Cada módulo tiene su propio valor en puntos (0 = contenido de apoyo, sin puntos). El tope es de
-- 20 puntos por mes calendario (hora Bogotá), no un número de módulos (decisión del equipo).
--   * Completar un módulo con puntos crea la fila con recompensa_estado = 'pendiente'.
--   * public.otorgar_modulos_pendientes otorga los pendientes en orden de llegada (FIFO) mientras quepan
--     en el tope del mes. No se parte un módulo: si no cabe completo, espera al mes siguiente, y los que
--     llegaron después también esperan (se respeta el orden).
--   * Corre al completar un módulo, al activarse la cuenta y en un cron el día 1 de cada mes a las 00:05.
--   * Una cuenta que no está activa no recibe puntos de módulos: quedan pendientes hasta su activación.

-- El valor de cada módulo vive en el catálogo; la regla deja de tener un valor fijo.
update public.reglas_puntos set puntos = null where motivo = 'modulo_completado';

-- Catálogo -------------------------------------------------------------------------------------------

alter table public.modulos
  add column codigo  text,
  add column puntos  integer not null default 0 check (puntos between 0 and 20);

comment on column public.modulos.codigo is 'Identificador del curso en la Academy del Hub (p. ej. c11).';
comment on column public.modulos.puntos is 'Puntos Sol del módulo; 0 = sin puntos. Máximo 20, el tope mensual.';

-- Cursos de la Academy del Hub (index.html, ACADEMY_CONFIG): los marcados con puntos valen 5.
insert into public.modulos (codigo, nombre, orden, puntos) values
  ('c11', '¿Qué empresas vale la pena referir?',              1, 5),
  ('c12', 'Cómo construir un Referido Perfecto',              2, 5),
  ('c13', 'Consumo energético: qué información necesitamos',  3, 0),
  ('c21', 'No vendemos paneles, hablamos de ahorro',          4, 5),
  ('c22', 'Preguntas para detectar una oportunidad',          5, 5),
  ('c23', 'Qué puedes prometer y qué no',                     6, 5),
  ('c31', 'Del referido al proyecto',                         7, 5),
  ('c41', 'Financiar la transición',                          8, 0),
  ('c51', 'Tu primera oportunidad',                           9, 0),
  ('c52', 'Puntos Sol, niveles y calidad',                   10, 5),
  ('c53', 'Beneficios, enlace, eventos y soporte',           11, 0);

alter table public.modulos
  alter column codigo set not null,
  add constraint modulos_codigo_key unique (codigo),
  add constraint modulos_codigo_formato check (codigo ~ '^[a-z0-9_-]{1,40}$');

-- Módulos completados ---------------------------------------------------------------------------------

-- Valor del módulo al completarlo: cambiar el catálogo después no altera lo ya ganado.
alter table public.modulos_completados
  add column puntos integer not null default 0 check (puntos >= 0);

alter table public.modulos_completados
  drop constraint modulos_completados_recompensa_estado_check,
  add constraint modulos_completados_recompensa_estado_check
    check (recompensa_estado in ('pendiente', 'otorgada', 'no_aplica')),
  add constraint modulos_completados_sin_puntos check ((recompensa_estado = 'no_aplica') = (puntos = 0));

comment on column public.modulos_completados.puntos is 'Puntos del módulo al completarlo; 0 = no_aplica.';

-- Antes de insertar: toma el valor del catálogo y define el estado inicial de la recompensa.
create function interno.modulos_completados_preparar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.puntos into new.puntos from public.modulos m where m.id = new.modulo_id;
  new.puntos            := coalesce(new.puntos, 0);
  new.recompensa_estado := case when new.puntos = 0 then 'no_aplica' else 'pendiente' end;
  new.fecha_otorgada    := null;
  return new;
end;
$$;

create trigger modulos_completados_preparar
  before insert on public.modulos_completados
  for each row execute function interno.modulos_completados_preparar();

-- Otorgamiento (§5.3) ---------------------------------------------------------------------------------

-- Devuelve los puntos otorgados. `p_ahora` permite ejecutarla en otra fecha (tests).
create function public.otorgar_modulos_pendientes(p_aliado uuid, p_ahora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tope      constant integer := 20;
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

-- Cron mensual: otorga a todos los aliados con pendientes. Devuelve los puntos otorgados en total.
create function interno.otorgar_modulos_todos(p_ahora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  r record;
begin
  for r in
    select distinct mc.aliado_id
    from public.modulos_completados mc
    where mc.recompensa_estado = 'pendiente'
  loop
    v_total := v_total + public.otorgar_modulos_pendientes(r.aliado_id, p_ahora);
  end loop;
  return v_total;
end;
$$;

create function interno.modulos_completados_otorgar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.otorgar_modulos_pendientes(new.aliado_id);
  return null;
end;
$$;

create trigger modulos_completados_otorgar
  after insert on public.modulos_completados
  for each row
  when (new.recompensa_estado = 'pendiente')
  execute function interno.modulos_completados_otorgar();

-- Al activarse la cuenta se otorgan los módulos que quedaron pendientes.
create function interno.aliados_otorgar_modulos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.otorgar_modulos_pendientes(new.id);
  return null;
end;
$$;

create trigger aliados_otorgar_modulos
  after update of estado on public.aliados
  for each row
  when (new.estado = 'activo' and old.estado is distinct from 'activo')
  execute function interno.aliados_otorgar_modulos();

-- Registro desde el Hub ---------------------------------------------------------------------------------

-- La llama POST /api/modulos con el aliado de la sesión (nunca de un campo del navegador).
-- Idempotente: completar dos veces el mismo módulo no cambia nada.
create function public.completar_modulo(p_aliado uuid, p_codigo text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_estado  text;
  v_modulo  public.modulos%rowtype;
  v_fila    public.modulos_completados%rowtype;
  v_nuevo   boolean;
begin
  select a.estado into v_estado from public.aliados a where a.id = p_aliado;
  if v_estado is distinct from 'activo' then
    raise exception 'aliado_no_activo: la cuenta no está activa';
  end if;

  select * into v_modulo from public.modulos m where m.codigo = p_codigo and m.activo;
  if not found then
    raise exception 'modulo_inexistente: el módulo no existe o no está disponible';
  end if;

  insert into public.modulos_completados (aliado_id, modulo_id)
  values (p_aliado, v_modulo.id)
  on conflict (aliado_id, modulo_id) do nothing;
  v_nuevo := found;

  select * into v_fila from public.modulos_completados mc
  where mc.aliado_id = p_aliado and mc.modulo_id = v_modulo.id;

  return jsonb_build_object(
    'codigo', v_modulo.codigo,
    'nuevo', v_nuevo,
    'puntos', v_fila.puntos,
    'recompensa_estado', v_fila.recompensa_estado,
    'fecha_completado', v_fila.fecha_completado,
    'fecha_otorgada', v_fila.fecha_otorgada
  );
end;
$$;

revoke execute on function interno.modulos_completados_preparar() from public, anon, authenticated;
revoke execute on function public.otorgar_modulos_pendientes(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function interno.otorgar_modulos_todos(timestamptz) from public, anon, authenticated;
revoke execute on function interno.modulos_completados_otorgar() from public, anon, authenticated;
revoke execute on function interno.aliados_otorgar_modulos() from public, anon, authenticated;
revoke execute on function public.completar_modulo(uuid, text) from public, anon, authenticated;
grant execute on function public.otorgar_modulos_pendientes(uuid, timestamptz) to service_role;
grant execute on function public.completar_modulo(uuid, text) to service_role;

-- Día 1 de cada mes, 00:05 hora Bogotá = 05:05 UTC.
select cron.schedule('otorgar-modulos-mensual', '5 5 1 * *', 'select interno.otorgar_modulos_todos()');
