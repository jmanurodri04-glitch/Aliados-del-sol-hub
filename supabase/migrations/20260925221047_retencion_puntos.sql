-- Fase 3 · 03 — Puntos retenidos mientras la cuenta no está activa (decisión del equipo).
--
-- Un aliado suspendido (o aún pendiente de aprobación) no gana ni pierde puntos: los movimientos
-- que le correspondan quedan en movimientos_retenidos y se acreditan en el libro mayor cuando
-- la cuenta vuelve a `activo`, con la fecha de la reactivación (así cuentan para la ventana
-- de 6 meses desde ese momento). Mientras no esté activo no puede canjear.
-- Los ajustes de admin se aplican siempre: son una decisión explícita de GEENERA.

create table public.movimientos_retenidos (
  id              uuid primary key default gen_random_uuid(),
  aliado_id       uuid not null references public.aliados (id) on delete cascade,
  tipo            text not null check (tipo in ('ganado', 'perdido')),
  puntos          integer not null check (puntos > 0),
  motivo          text not null references public.reglas_puntos (motivo),
  vinculo         text not null,
  vinculo_id      text,
  clave_unica     text not null unique,
  fecha_original  timestamptz not null,
  creado_por      text not null,
  nota            text,
  estado_aliado   text not null,                         -- estado de la cuenta cuando se retuvo
  retenido_at     timestamptz not null default now(),
  secuencia       bigint generated always as identity
);

comment on table public.movimientos_retenidos is 'Movimientos de un aliado no activo; se pasan al libro mayor al reactivarse la cuenta.';

create index movimientos_retenidos_aliado_idx on public.movimientos_retenidos (aliado_id, fecha_original, secuencia);
create index movimientos_retenidos_motivo_idx on public.movimientos_retenidos (motivo);

alter table public.movimientos_retenidos enable row level security;
revoke all on table public.movimientos_retenidos from anon, authenticated;
grant all on table public.movimientos_retenidos to service_role;
grant select on table public.movimientos_retenidos to authenticated;
create policy movimientos_retenidos_select on public.movimientos_retenidos
  for select to authenticated
  using ((select interno.es_admin()));

-- Se reemplaza la preparación del libro mayor (fase 3 · 01) para retener lo que llega
-- mientras la cuenta no está activa.
create or replace function interno.movimientos_puntos_preparar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regla       public.reglas_puntos%rowtype;
  v_estado      text;
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

  -- Bloquea al aliado para que dos movimientos simultáneos no lean el mismo saldo.
  select a.estado into v_estado from public.aliados a where a.id = new.aliado_id for update;

  if v_estado is distinct from 'activo' and new.motivo <> 'ajuste_admin' then
    if new.tipo = 'redimido' then
      raise exception 'aliado_no_activo: una cuenta en estado % no puede canjear puntos', v_estado;
    end if;
    -- Si la clave ya está en el libro, el movimiento ya se aplicó: no se retiene de nuevo.
    if not exists (select 1 from public.movimientos_puntos m where m.clave_unica = new.clave_unica) then
      insert into public.movimientos_retenidos
        (aliado_id, tipo, puntos, motivo, vinculo, vinculo_id, clave_unica, fecha_original, creado_por, nota, estado_aliado)
      values
        (new.aliado_id, new.tipo, new.puntos, new.motivo, new.vinculo, new.vinculo_id, new.clave_unica, new.fecha,
         new.creado_por, new.nota, coalesce(v_estado, 'desconocido'))
      on conflict (clave_unica) do nothing;
    end if;
    return null; -- no entra al libro mayor por ahora
  end if;

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

-- Al activarse la cuenta, los retenidos pasan al libro mayor en su orden original.
create function interno.liberar_movimientos_retenidos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, vinculo_id, clave_unica, creado_por, nota)
  select m.aliado_id, m.tipo,
         case when r.puntos is null then m.puntos end, -- los motivos de valor fijo toman el valor vigente de la regla
         m.motivo, m.vinculo, m.vinculo_id, m.clave_unica, m.creado_por,
         concat_ws(' · ', m.nota, format('Retenido mientras la cuenta estaba %s (fecha original %s)',
           m.estado_aliado, to_char(m.fecha_original at time zone 'America/Bogota', 'YYYY-MM-DD')))
  from public.movimientos_retenidos m
  join public.reglas_puntos r on r.motivo = m.motivo
  where m.aliado_id = new.id
  order by m.fecha_original, m.secuencia
  on conflict (clave_unica) do nothing;

  delete from public.movimientos_retenidos m where m.aliado_id = new.id;
  return null;
end;
$$;

create trigger aliados_liberar_movimientos_retenidos
  after update of estado on public.aliados
  for each row
  when (new.estado = 'activo' and old.estado is distinct from 'activo')
  execute function interno.liberar_movimientos_retenidos();

revoke execute on function interno.liberar_movimientos_retenidos() from public, anon, authenticated;
