-- Fase 7 · 01 — Racha Solar 4x4 (CLAUDE.md §5.2).
--
-- Una semana (lunes 00:00 – domingo 23:59, hora Bogotá) cuenta si el aliado tiene al menos una empresa
-- que pasó a calificada en ella. Cuatro semanas seguidas dan +75 (racha_solar).
--
-- Secuencia (§5.2): aplicar_avance_clientify guarda fecha_calificado, inserta empresa_calificada (+30) y,
-- DESPUÉS, el trigger de este archivo actualiza la racha con esa misma fecha. Al ser un trigger del libro
-- mayor, el orden se cumple venga la calificación de donde venga.
--
-- Decisiones del equipo:
--   * Al completar 4 de 4 la racha se ve completa el resto de esa semana y el cron del lunes siguiente
--     la vuelve a 0 0 0 0.
--   * Una calificación retenida mientras la cuenta no estaba activa no cuenta para la racha: al liberarse,
--     su fecha de calificación ya no está en la semana en que entra al libro.

-- Lunes (fecha) de la semana de p_fecha en hora Bogotá.
create function interno.lunes_bogota(p_fecha timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', p_fecha at time zone 'America/Bogota')::date;
$$;

-- Cuenta la semana de p_fecha en la racha del aliado. Devuelve true si con ella completó 4 de 4.
create function interno.actualizar_racha(p_aliado uuid, p_fecha timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana  date := interno.lunes_bogota(p_fecha);
  v_aliado  public.aliados%rowtype;
  v_n       integer;
begin
  select * into v_aliado from public.aliados a where a.id = p_aliado for update;
  if not found then
    return false;
  end if;

  -- Semana ya contada (o anterior a la última contada): no cambia nada.
  if v_aliado.racha_ultima_semana is not null and v_semana <= v_aliado.racha_ultima_semana then
    return false;
  end if;

  v_n := v_aliado.racha_semana_1::integer + v_aliado.racha_semana_2::integer
       + v_aliado.racha_semana_3::integer + v_aliado.racha_semana_4::integer;

  if v_aliado.racha_ultima_semana = v_semana - 7 and v_n between 1 and 3 then
    v_n := v_n + 1;  -- semana siguiente a la última contada: la racha avanza
  else
    v_n := 1;        -- racha completa o semana saltada: empieza de nuevo
  end if;

  update public.aliados a set
    racha_semana_1      = v_n >= 1,
    racha_semana_2      = v_n >= 2,
    racha_semana_3      = v_n >= 3,
    racha_semana_4      = v_n >= 4,
    racha_ultima_semana = v_semana
  where a.id = p_aliado;

  if v_n < 4 then
    return false;
  end if;

  -- Garantía (§5.2): no más de un racha_solar por aliado en 28 días.
  if exists (
    select 1 from public.movimientos_puntos m
    where m.aliado_id = p_aliado
      and m.motivo = 'racha_solar'
      and m.fecha > p_fecha - interval '28 days'
  ) then
    return false;
  end if;

  insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por, fecha)
  values (p_aliado, 'ganado', 'racha_solar', 'racha', v_semana::text,
          'racha:' || p_aliado || ':' || v_semana, 'sistema', p_fecha)
  on conflict (clave_unica) do nothing;

  return true;
end;
$$;

-- Después de registrar empresa_calificada, cuenta la semana de su fecha de calificación.
create function interno.movimientos_puntos_racha()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha_calificado timestamptz;
begin
  if new.vinculo = 'empresas'
     and new.vinculo_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select a.fecha_calificado into v_fecha_calificado
    from public.avance_empresa a
    where a.empresa_id = new.vinculo_id::uuid;
  end if;
  v_fecha_calificado := coalesce(v_fecha_calificado, new.fecha);

  -- Retenido y liberado en otra semana: la calificación ocurrió con la cuenta inactiva, no cuenta.
  if interno.lunes_bogota(v_fecha_calificado) <> interno.lunes_bogota(new.fecha) then
    return null;
  end if;

  perform interno.actualizar_racha(new.aliado_id, v_fecha_calificado);
  return null;
end;
$$;

-- El nombre ordena este trigger antes de movimientos_puntos_recalcular: racha y, después, saldos y nivel (§8).
create trigger movimientos_puntos_racha
  after insert on public.movimientos_puntos
  for each row
  when (new.motivo = 'empresa_calificada')
  execute function interno.movimientos_puntos_racha();

-- Cron semanal (lunes 00:05 Bogotá): vuelve a 0 0 0 0 la racha completada la semana anterior y la de
-- quien no calificó ninguna empresa en la semana que acaba de terminar.
create function interno.reiniciar_rachas(p_ahora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lunes date := interno.lunes_bogota(p_ahora);
  v_total integer;
begin
  update public.aliados a set
    racha_semana_1 = false,
    racha_semana_2 = false,
    racha_semana_3 = false,
    racha_semana_4 = false
  where (a.racha_semana_1 or a.racha_semana_2 or a.racha_semana_3 or a.racha_semana_4)
    and a.racha_ultima_semana < v_lunes
    and (a.racha_semana_4 or a.racha_ultima_semana < v_lunes - 7);
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

revoke execute on function interno.lunes_bogota(timestamptz) from public, anon, authenticated;
revoke execute on function interno.actualizar_racha(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function interno.movimientos_puntos_racha() from public, anon, authenticated;
revoke execute on function interno.reiniciar_rachas(timestamptz) from public, anon, authenticated;

-- 00:05 hora Bogotá del lunes = 05:05 UTC (Colombia no tiene horario de verano).
select cron.schedule('reiniciar-rachas-semanal', '5 5 * * 1', 'select interno.reiniciar_rachas()');
