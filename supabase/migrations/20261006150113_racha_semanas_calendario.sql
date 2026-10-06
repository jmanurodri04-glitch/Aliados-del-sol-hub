-- Racha Solar: la garantía de «un +75 cada 28 días» se mide en semanas calendario (CLAUDE.md §5.2).
--
-- Antes se comparaban los momentos exactos: una racha completada un domingo y la siguiente completada el lunes
-- de su cuarta semana quedan a 22 días, así que el segundo +75 se bloqueaba. Como esa semana ya quedaba
-- contada, ninguna calificación posterior lo volvía a intentar y el cron del lunes reiniciaba la racha:
-- el aliado perdía los 75 puntos (hallado en las pruebas de aceptación, oct 2026).
--
-- Ahora se compara el lunes de la semana de la racha anterior con el de la actual: deben estar separados al
-- menos 4 semanas. Dos rachas válidas nunca comparten semanas, así que la garantía sigue igual de firme.

create or replace function interno.actualizar_racha(p_aliado uuid, p_fecha timestamptz)
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

  -- Garantía (§5.2): no más de un racha_solar por aliado en 4 semanas calendario. Se comparan los lunes de
  -- las semanas, no las horas: la racha siguiente ocupa las 4 semanas que siguen y su cuarta semana empieza
  -- exactamente 28 días después de la cuarta semana de la anterior, aunque entre los dos momentos de
  -- calificación haya solo 22 días (domingo → lunes).
  if exists (
    select 1 from public.movimientos_puntos m
    where m.aliado_id = p_aliado
      and m.motivo = 'racha_solar'
      and interno.lunes_bogota(m.fecha) > v_semana - 28
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
