-- Fase 3 · 01 — Libro mayor de puntos y recálculos (CLAUDE.md §4.7, §5, §5.4, §6).
--
-- Quien registra un movimiento solo inserta en movimientos_puntos (con ON CONFLICT DO NOTHING).
-- La base de datos se encarga del resto:
--   * completa y valida `puntos` según reglas_puntos;
--   * calcula `puntos_aplicados` con piso en 0 y sin memoria, bloqueando al aliado;
--   * recalcula puntos_disponibles, puntos_nivel, calidad_referidos y nivel del aliado.
-- Un cron diario recalcula puntos_nivel, que baja solo con el paso del tiempo (ventana de 6 meses).

create extension if not exists pg_cron with schema pg_catalog;

-- Orden determinista del libro: dos movimientos pueden tener la misma `fecha`
-- (p. ej. varios en la misma transacción) y el piso en 0 depende del orden.
alter table public.movimientos_puntos
  add column secuencia bigint generated always as identity;

create index movimientos_puntos_ventana_idx
  on public.movimientos_puntos (aliado_id, fecha, secuencia)
  where tipo in ('ganado', 'perdido');

-- Catálogo de reglas (§5) ------------------------------------------------------------

create table public.reglas_puntos (
  motivo       text primary key,
  tipo         text check (tipo in ('ganado', 'perdido', 'redimido')), -- NULL: puede ser ganado o perdido
  puntos       integer check (puntos > 0),                             -- NULL: valor variable
  descripcion  text not null
);

comment on table public.reglas_puntos is 'Valor nominal de cada motivo de Puntos Sol (CLAUDE.md §5). Cambiar un valor no altera movimientos ya registrados.';

insert into public.reglas_puntos (motivo, tipo, puntos, descripcion) values
  ('registro_valido',        'ganado',   10,  'Registro válido'),
  ('referido_perfecto',      'ganado',   20,  'Referido perfecto'),
  ('referido_imperfecto',    'perdido',  5,   'Referido imperfecto'),
  ('empresa_calificada',     'ganado',   30,  'Empresa calificada'),
  ('referido_no_calificado', 'perdido',  10,  'Referido no calificado'),
  ('evaluacion_tecnica',     'ganado',   30,  'Evaluación técnica realizada'),
  ('propuesta_comercial',    'ganado',   50,  'Propuesta comercial'),
  ('negocio_cerrado',        'ganado',   150, 'Negocio cerrado'),
  ('fuera_perfil',           'perdido',  15,  'Referido fuera del perfil'),
  ('informacion_falsa',      'perdido',  30,  'Información falsa'),
  ('baja_calidad_reiterada', 'perdido',  20,  'Baja calidad reiterada'),
  ('modulo_completado',      'ganado',   5,   'Módulo completado'),
  ('evento_validado',        'ganado',   100, 'Evento validado'),
  ('racha_solar',            'ganado',   75,  'Racha Solar 4x4'),
  ('ajuste_admin',           null,       null, 'Ajuste de administrador'),
  ('canje',                  'redimido', null, 'Canje de recompensa');

alter table public.movimientos_puntos
  add constraint movimientos_puntos_motivo_fkey foreign key (motivo) references public.reglas_puntos (motivo);

alter table public.reglas_puntos enable row level security;
revoke all on table public.reglas_puntos from anon, authenticated;
grant all on table public.reglas_puntos to service_role;
grant select on table public.reglas_puntos to authenticated;
create policy reglas_puntos_select on public.reglas_puntos for select to authenticated using (true);

-- Cálculos de saldo (§5.4) --------------------------------------------------------------

-- Histórico, no vence: Σ aplicados(ganado) − Σ aplicados(perdido) − Σ aplicados(redimido).
create function public.calcular_puntos_disponibles(p_aliado uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when m.tipo = 'ganado' then m.puntos_aplicados else -m.puntos_aplicados end), 0)::integer
  from public.movimientos_puntos m
  where m.aliado_id = p_aliado;
$$;

-- Ventana de 6 meses, suma acumulada con piso en 0 y valor nominal, en orden cronológico.
-- Ejemplo: +10, −30, +20 → 10 → 0 → 20. `p_ahora` permite calcular en otra fecha (tests, cron).
create function public.calcular_puntos_nivel(p_aliado uuid, p_ahora timestamptz default now())
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_desde timestamptz := ((p_ahora at time zone 'America/Bogota') - interval '6 months') at time zone 'America/Bogota';
  v_saldo integer := 0;
  r record;
begin
  for r in
    select m.tipo, m.puntos
    from public.movimientos_puntos m
    where m.aliado_id = p_aliado
      and m.tipo in ('ganado', 'perdido')
      and m.fecha >= v_desde
      and m.fecha <= p_ahora
    order by m.fecha, m.secuencia
  loop
    v_saldo := greatest(0, v_saldo + case when r.tipo = 'ganado' then r.puntos else -r.puntos end);
  end loop;
  return v_saldo;
end;
$$;

-- Calidad del aliado (§6.2): promedio de calidad_empresa no nula, sin ventana de tiempo.
create function public.calcular_calidad_referidos(p_aliado uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select round(avg(a.calidad_empresa), 2)
  from public.avance_empresa a
  join public.empresas e on e.id = a.empresa_id
  where e.aliado_id = p_aliado
    and a.calidad_empresa is not null;
$$;

revoke execute on function public.calcular_puntos_disponibles(uuid) from public, anon, authenticated;
revoke execute on function public.calcular_puntos_nivel(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.calcular_calidad_referidos(uuid) from public, anon, authenticated;

-- Actualiza la caché del aliado (saldos, calidad y nivel). Solo escribe si algo cambió.
create function interno.recalcular_aliado(p_aliado uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_disponibles integer := public.calcular_puntos_disponibles(p_aliado);
  v_nivel_pts   integer := public.calcular_puntos_nivel(p_aliado);
  v_calidad     numeric := public.calcular_calidad_referidos(p_aliado);
  v_nivel       public.nivel := public.calcular_nivel(v_nivel_pts, v_calidad);
begin
  update public.aliados a
  set puntos_disponibles = v_disponibles,
      puntos_nivel       = v_nivel_pts,
      calidad_referidos  = v_calidad,
      nivel              = v_nivel
  where a.id = p_aliado
    and (a.puntos_disponibles, a.puntos_nivel, a.calidad_referidos, a.nivel)
        is distinct from (v_disponibles, v_nivel_pts, v_calidad, v_nivel);
end;
$$;

-- Recalcula a todos los aliados. La usa el cron diario.
create function interno.recalcular_todos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  r record;
begin
  for r in select a.id from public.aliados a loop
    perform interno.recalcular_aliado(r.id);
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;

revoke execute on function interno.recalcular_aliado(uuid) from public, anon, authenticated;
revoke execute on function interno.recalcular_todos() from public, anon, authenticated;

-- Triggers del libro mayor ------------------------------------------------------------

-- Antes de insertar: valida el valor según la regla y calcula puntos_aplicados.
-- Bloquea la fila del aliado para que dos movimientos simultáneos no lean el mismo saldo.
create function interno.movimientos_puntos_preparar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regla       public.reglas_puntos%rowtype;
  v_disponibles integer;
begin
  select * into v_regla from public.reglas_puntos r where r.motivo = new.motivo;
  -- Motivo inexistente: lo reporta la FK hacia reglas_puntos.

  if v_regla.puntos is not null then
    if new.puntos is null then
      new.puntos := v_regla.puntos;
    elsif new.puntos <> v_regla.puntos then
      raise exception 'El motivo % vale % puntos (se recibieron %)', new.motivo, v_regla.puntos, new.puntos;
    end if;
  end if;

  perform 1 from public.aliados a where a.id = new.aliado_id for update;
  v_disponibles := public.calcular_puntos_disponibles(new.aliado_id);

  if new.tipo = 'perdido' then
    -- Piso en 0 y sin memoria: lo que no se puede descontar se pierde.
    new.puntos_aplicados := least(new.puntos, v_disponibles);
  elsif new.tipo = 'redimido' then
    if new.puntos > v_disponibles then
      raise exception 'saldo_insuficiente: se intentan redimir % puntos y el saldo disponible es %', new.puntos, v_disponibles;
    end if;
    new.puntos_aplicados := new.puntos;
  else
    new.puntos_aplicados := new.puntos;
  end if;

  return new;
end;
$$;

create trigger movimientos_puntos_preparar
  before insert on public.movimientos_puntos
  for each row execute function interno.movimientos_puntos_preparar();

create function interno.movimientos_puntos_recalcular()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform interno.recalcular_aliado(new.aliado_id);
  return null;
end;
$$;

create trigger movimientos_puntos_recalcular
  after insert on public.movimientos_puntos
  for each row execute function interno.movimientos_puntos_recalcular();

-- Triggers de calidad (§6.2) ------------------------------------------------------------

create function interno.avance_empresa_recalcular()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aliado uuid;
begin
  select e.aliado_id into v_aliado
  from public.empresas e
  where e.id = coalesce(new.empresa_id, old.empresa_id);
  -- Si la empresa ya no existe (borrado en cascada), recalcula el trigger de empresas.
  if v_aliado is not null then
    perform interno.recalcular_aliado(v_aliado);
  end if;
  return null;
end;
$$;

create trigger avance_empresa_recalcular
  after insert or delete or update of calificado, perfecto, oportunidad_tecnica, integridad_informacion
  on public.avance_empresa
  for each row execute function interno.avance_empresa_recalcular();

create function interno.empresas_recalcular()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform interno.recalcular_aliado(old.aliado_id);
  if tg_op = 'UPDATE' then
    perform interno.recalcular_aliado(new.aliado_id);
  end if;
  return null;
end;
$$;

create trigger empresas_recalcular
  after delete or update of aliado_id on public.empresas
  for each row execute function interno.empresas_recalcular();

revoke execute on function interno.movimientos_puntos_preparar() from public, anon, authenticated;
revoke execute on function interno.movimientos_puntos_recalcular() from public, anon, authenticated;
revoke execute on function interno.avance_empresa_recalcular() from public, anon, authenticated;
revoke execute on function interno.empresas_recalcular() from public, anon, authenticated;

-- Cron diario (§5.4): 00:15 hora Bogotá = 05:15 UTC (Colombia no tiene horario de verano).
select cron.schedule('recalcular-puntos-diario', '15 5 * * *', 'select interno.recalcular_todos()');
