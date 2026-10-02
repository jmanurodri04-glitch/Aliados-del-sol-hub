-- Tests de la Racha Solar 4x4 (CLAUDE.md §5.2).
-- Semanas de prueba (lunes, hora Bogotá): W1 2026-06-01 · W2 06-08 · W3 06-15 · W4 06-22 · W5 06-29.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

create function pg_temp.aliado(id uuid, email text, activo boolean default true)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Prueba Racha', 'celular', '+5730' || lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0'), 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
  if activo then
    update public.aliados set estado = 'activo' where aliados.id = aliado.id;
  end if;
end;
$$;

-- Califica una empresa nueva del aliado como lo hace aplicar_avance_clientify: primero la fecha de
-- calificación y después el movimiento empresa_calificada con esa misma fecha.
create function pg_temp.calificar(p_aliado uuid, p_fecha timestamptz)
returns void language plpgsql as $$
declare
  v_empresa uuid := gen_random_uuid();
begin
  insert into public.empresas (id, aliado_id, origen, empresa, sector, nombre_contacto, telefono, correo, valor_factura, es_perfecto, autorizacion_contacto_at)
  values (v_empresa, p_aliado, 'hub', 'Empresa ' || v_empresa, 'Industrial', 'Contacto', '3001234567',
          v_empresa || '@racha.test', 1, false, now());
  insert into public.avance_empresa (empresa_id, calificado, fecha_calificado) values (v_empresa, 'si', p_fecha);
  insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por, fecha)
  values (p_aliado, 'ganado', 'empresa_calificada', 'empresas', v_empresa::text,
          'empresa:' || v_empresa || ':calificado', 'webhook_clientify', p_fecha);
end;
$$;

create function pg_temp.racha(p_aliado uuid) returns text language sql as $$
  select concat(a.racha_semana_1::int, a.racha_semana_2::int, a.racha_semana_3::int, a.racha_semana_4::int)
  from public.aliados a where a.id = p_aliado;
$$;
create function pg_temp.ultima(p_aliado uuid) returns date language sql as $$
  select a.racha_ultima_semana from public.aliados a where a.id = p_aliado;
$$;
create function pg_temp.bonos(p_aliado uuid) returns bigint language sql as $$
  select count(*) from public.movimientos_puntos m where m.aliado_id = p_aliado and m.motivo = 'racha_solar';
$$;

select pg_temp.aliado('a1000000-0000-0000-0000-000000000001', 'a@racha.test');
select pg_temp.aliado('b1000000-0000-0000-0000-000000000001', 'b@racha.test');
select pg_temp.aliado('c1000000-0000-0000-0000-000000000001', 'c@racha.test');
select pg_temp.aliado('d1000000-0000-0000-0000-000000000001', 'd@racha.test');
select pg_temp.aliado('e1000000-0000-0000-0000-000000000001', 'e@racha.test', false);

-- A: racha completa ------------------------------------------------------------------------------

select is(pg_temp.racha('a1000000-0000-0000-0000-000000000001'), '0000', 'un aliado nuevo empieza con la racha en 0 0 0 0');

select pg_temp.calificar('a1000000-0000-0000-0000-000000000001', '2026-06-03 10:00-05');
select is(pg_temp.racha('a1000000-0000-0000-0000-000000000001'), '1000', 'la primera calificación marca la semana 1');
select is(pg_temp.ultima('a1000000-0000-0000-0000-000000000001'), '2026-06-01'::date, 'racha_ultima_semana es el lunes de esa semana');

select pg_temp.calificar('a1000000-0000-0000-0000-000000000001', '2026-06-05 16:00-05');
select is(pg_temp.racha('a1000000-0000-0000-0000-000000000001'), '1000', 'otra calificación en la misma semana no cuenta dos veces');

select pg_temp.calificar('a1000000-0000-0000-0000-000000000001', '2026-06-09 09:00-05');
select is(pg_temp.racha('a1000000-0000-0000-0000-000000000001'), '1100', 'la semana siguiente marca la semana 2');
select pg_temp.calificar('a1000000-0000-0000-0000-000000000001', '2026-06-19 12:00-05');
select is(pg_temp.racha('a1000000-0000-0000-0000-000000000001'), '1110', 'la semana 3');
select is(pg_temp.bonos('a1000000-0000-0000-0000-000000000001'), 0::bigint, 'con 3 de 4 aún no hay bono');

select pg_temp.calificar('a1000000-0000-0000-0000-000000000001', '2026-06-24 11:00-05');
select is(pg_temp.racha('a1000000-0000-0000-0000-000000000001'), '1111', 'la semana 4 completa la racha');
select row_eq(
  $$select m.puntos, m.tipo, m.vinculo, m.clave_unica, m.fecha from public.movimientos_puntos m
    where m.aliado_id = 'a1000000-0000-0000-0000-000000000001' and m.motivo = 'racha_solar'$$,
  row(75, 'ganado'::text, 'racha'::text, 'racha:a1000000-0000-0000-0000-000000000001:2026-06-22'::text, '2026-06-24 11:00-05'::timestamptz),
  'al completar 4 de 4 se registra racha_solar (+75) con la fecha de la calificación'
);
select is((select puntos_disponibles from public.aliados where id = 'a1000000-0000-0000-0000-000000000001'), 5 * 30 + 75,
  'el saldo suma las 5 calificaciones y el bono');
select ok(
  (select m.secuencia from public.movimientos_puntos m where m.clave_unica = 'racha:a1000000-0000-0000-0000-000000000001:2026-06-22')
  > (select m.secuencia from public.movimientos_puntos m join public.avance_empresa a on a.empresa_id::text = m.vinculo_id
     where m.aliado_id = 'a1000000-0000-0000-0000-000000000001' and m.motivo = 'empresa_calificada'
       and a.fecha_calificado = '2026-06-24 11:00-05'),
  'el bono se registra después del +30 de la calificación que completa la racha'
);

-- Cron del lunes -------------------------------------------------------------------------------------

select interno.reiniciar_rachas('2026-06-25 08:00-05');
select is(pg_temp.racha('a1000000-0000-0000-0000-000000000001'), '1111', 'la racha completa se sigue viendo el resto de su semana');

select interno.reiniciar_rachas('2026-06-29 00:05-05');
select is(pg_temp.racha('a1000000-0000-0000-0000-000000000001'), '0000', 'el lunes siguiente la racha completa vuelve a 0 0 0 0');

select pg_temp.calificar('a1000000-0000-0000-0000-000000000001', '2026-06-30 10:00-05');
select is(pg_temp.racha('a1000000-0000-0000-0000-000000000001'), '1000', 'después de completarla, empieza una racha nueva');
select is(pg_temp.bonos('a1000000-0000-0000-0000-000000000001'), 1::bigint, 'y no hay un segundo bono');

-- B: semana saltada e inactividad ------------------------------------------------------------------------

select pg_temp.calificar('b1000000-0000-0000-0000-000000000001', '2026-06-02 10:00-05');
select pg_temp.calificar('b1000000-0000-0000-0000-000000000001', '2026-06-10 10:00-05');
select pg_temp.calificar('b1000000-0000-0000-0000-000000000001', '2026-06-23 10:00-05');
select is(pg_temp.racha('b1000000-0000-0000-0000-000000000001'), '1000', 'una semana sin calificar reinicia la racha en la semana 1');
select is(pg_temp.ultima('b1000000-0000-0000-0000-000000000001'), '2026-06-22'::date, 'y cuenta la semana nueva');

select pg_temp.calificar('b1000000-0000-0000-0000-000000000001', '2026-06-12 10:00-05');
select is(pg_temp.racha('b1000000-0000-0000-0000-000000000001'), '1000', 'una calificación de una semana anterior no cambia la racha');

select interno.reiniciar_rachas('2026-06-29 00:05-05');
select is(pg_temp.racha('b1000000-0000-0000-0000-000000000001'), '1000', 'el cron no reinicia si calificó en la semana que terminó');
select interno.reiniciar_rachas('2026-07-06 00:05-05');
select is(pg_temp.racha('b1000000-0000-0000-0000-000000000001'), '0000', 'el cron reinicia a quien no calificó en la semana que terminó');

-- C: borde domingo 23:59 / lunes 00:00 (hora Bogotá) ---------------------------------------------------

select pg_temp.calificar('c1000000-0000-0000-0000-000000000001', '2026-06-07 23:59-05');
select is(pg_temp.ultima('c1000000-0000-0000-0000-000000000001'), '2026-06-01'::date, 'el domingo 23:59 pertenece a la semana del lunes anterior');
select pg_temp.calificar('c1000000-0000-0000-0000-000000000001', '2026-06-08 00:00-05');
select is(pg_temp.racha('c1000000-0000-0000-0000-000000000001'), '1100', 'el lunes 00:00 ya es la semana siguiente');

-- D: garantía de 28 días --------------------------------------------------------------------------------

insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, clave_unica, creado_por, fecha)
values ('d1000000-0000-0000-0000-000000000001', 'ganado', 'racha_solar', 'racha', 'racha:prueba-anterior', 'sistema', '2026-06-01 10:00-05');
select pg_temp.calificar('d1000000-0000-0000-0000-000000000001', '2026-06-01 12:00-05');
select pg_temp.calificar('d1000000-0000-0000-0000-000000000001', '2026-06-08 12:00-05');
select pg_temp.calificar('d1000000-0000-0000-0000-000000000001', '2026-06-15 12:00-05');
select pg_temp.calificar('d1000000-0000-0000-0000-000000000001', '2026-06-22 12:00-05');
select is(pg_temp.racha('d1000000-0000-0000-0000-000000000001'), '1111', 'la racha se completa');
select is(pg_temp.bonos('d1000000-0000-0000-0000-000000000001'), 1::bigint, 'pero no hay un segundo racha_solar en menos de 28 días');

-- E: calificación retenida mientras la cuenta no estaba activa --------------------------------------------

select pg_temp.calificar('e1000000-0000-0000-0000-000000000001', '2026-06-03 10:00-05');
update public.aliados set estado = 'activo' where id = 'e1000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.movimientos_puntos where aliado_id = 'e1000000-0000-0000-0000-000000000001' and motivo = 'empresa_calificada'),
  1::bigint, 'al activarse, la calificación retenida entra al libro'
);
select is(pg_temp.racha('e1000000-0000-0000-0000-000000000001'), '0000', 'pero no cuenta para la racha');

-- Programación y privilegios -------------------------------------------------------------------------------

select is((select schedule from cron.job where jobname = 'reiniciar-rachas-semanal'), '5 5 * * 1',
  'el reinicio se programa los lunes a las 00:05 hora Bogotá (05:05 UTC)');
select ok(not has_function_privilege('authenticated', 'interno.actualizar_racha(uuid, timestamptz)', 'execute'),
  'el navegador no puede modificar la racha');

select * from finish();
rollback;
