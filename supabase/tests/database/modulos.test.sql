-- Tests de los módulos de Academy y su recompensa (CLAUDE.md §4.9, §5.3; tope de 20 puntos por mes).
-- `now()` es fijo dentro de la transacción: el "mes en curso" de los tests es el de la fecha en que corren,
-- y el mes siguiente se simula pasando p_ahora al día 1 a las 00:05 hora Bogotá.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

create function pg_temp.aliado(id uuid, email text, activo boolean default true)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Prueba Módulos', 'celular', '+5730' || lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0'), 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
  if activo then
    update public.aliados set estado = 'activo' where aliados.id = aliado.id;
  end if;
end;
$$;

-- Completa un módulo como lo registra el servidor, con un orden de llegada explícito (minutos atrás).
create function pg_temp.completar(p_aliado uuid, p_codigo text, p_minutos_atras integer)
returns void language sql as $$
  insert into public.modulos_completados (aliado_id, modulo_id, fecha_completado)
  select p_aliado, m.id, now() - make_interval(mins => p_minutos_atras)
  from public.modulos m where m.codigo = p_codigo;
$$;

create function pg_temp.estado(p_aliado uuid, p_codigo text) returns text language sql as $$
  select mc.recompensa_estado from public.modulos_completados mc
  join public.modulos m on m.id = mc.modulo_id
  where mc.aliado_id = p_aliado and m.codigo = p_codigo;
$$;
create function pg_temp.disponibles(p_aliado uuid) returns integer language sql as $$
  select a.puntos_disponibles from public.aliados a where a.id = p_aliado;
$$;

-- El mes siguiente al de la fecha en que corre el test, día 1 a las 00:05 hora Bogotá.
create function pg_temp.mes_siguiente() returns timestamptz language sql as $$
  select ((date_trunc('month', now() at time zone 'America/Bogota') + interval '1 month 5 minutes') at time zone 'America/Bogota');
$$;

insert into public.modulos (codigo, nombre, orden, puntos) values
  ('t10', 'Prueba 10 puntos', 100, 10),
  ('t15', 'Prueba 15 puntos', 101, 15),
  ('t05', 'Prueba 5 puntos',  102, 5),
  ('m1', 'Prueba m1', 110, 5), ('m2', 'Prueba m2', 111, 5), ('m3', 'Prueba m3', 112, 5), ('m4', 'Prueba m4', 113, 5),
  ('m5', 'Prueba m5', 114, 5), ('m6', 'Prueba m6', 115, 5), ('m7', 'Prueba m7', 116, 5), ('m8', 'Prueba m8', 117, 5);
insert into public.modulos (codigo, nombre, orden, puntos, activo) values ('off', 'Prueba inactivo', 120, 5, false);

select pg_temp.aliado('a2000000-0000-0000-0000-000000000001', 'a@modulos.test');
select pg_temp.aliado('b2000000-0000-0000-0000-000000000001', 'b@modulos.test');
select pg_temp.aliado('c2000000-0000-0000-0000-000000000001', 'c@modulos.test');
select pg_temp.aliado('d2000000-0000-0000-0000-000000000001', 'd@modulos.test', false);

-- Catálogo -------------------------------------------------------------------------------------------------

select is((select count(*) from public.modulos where codigo ~ '^c[0-9]{2}$'), 11::bigint, 'el catálogo trae los 11 cursos de la Academy');
select is((select count(*) from public.modulos where codigo ~ '^c[0-9]{2}$' and puntos = 5), 7::bigint, '7 cursos dan 5 puntos');
select is((select count(*) from public.modulos where codigo ~ '^c[0-9]{2}$' and puntos = 0), 4::bigint, 'y 4 son contenido sin puntos');
select is((select puntos from public.reglas_puntos where motivo = 'modulo_completado'), null::integer,
  'la regla modulo_completado no tiene valor fijo: lo define cada módulo');
select throws_ok($$insert into public.modulos (codigo, nombre, puntos) values ('t99', 'Demasiado', 25)$$,
  '23514', null, 'un módulo no puede valer más que el tope mensual de 20');

-- A: valores distintos y orden de llegada ---------------------------------------------------------------------

select pg_temp.completar('a2000000-0000-0000-0000-000000000001', 't10', 30);
select is(pg_temp.estado('a2000000-0000-0000-0000-000000000001', 't10'), 'otorgada', 'un módulo de 10 cabe en el tope del mes');
select is(pg_temp.disponibles('a2000000-0000-0000-0000-000000000001'), 10, 'suma sus 10 puntos');

select pg_temp.completar('a2000000-0000-0000-0000-000000000001', 't15', 20);
select is(pg_temp.estado('a2000000-0000-0000-0000-000000000001', 't15'), 'pendiente', '10 + 15 supera los 20: queda pendiente');

select pg_temp.completar('a2000000-0000-0000-0000-000000000001', 't05', 10);
select is(pg_temp.estado('a2000000-0000-0000-0000-000000000001', 't05'), 'pendiente',
  'uno de 5 que llegó después también espera: se respeta el orden de llegada');
select is(pg_temp.disponibles('a2000000-0000-0000-0000-000000000001'), 10, 'no se otorgan puntos parciales');

select is(public.otorgar_modulos_pendientes('a2000000-0000-0000-0000-000000000001', pg_temp.mes_siguiente()), 20,
  'el día 1 del mes siguiente se otorgan los pendientes (15 + 5)');
select is(pg_temp.estado('a2000000-0000-0000-0000-000000000001', 't05'), 'otorgada', 'y quedan otorgados');
select is(pg_temp.disponibles('a2000000-0000-0000-0000-000000000001'), 30, 'saldo total: 10 + 15 + 5');
select is(
  (select m.fecha from public.movimientos_puntos m
   join public.modulos_completados mc on mc.id::text = m.vinculo_id
   join public.modulos mo on mo.id = mc.modulo_id
   where mc.aliado_id = 'a2000000-0000-0000-0000-000000000001' and mo.codigo = 't15'),
  pg_temp.mes_siguiente(), 'el movimiento lleva la fecha en que se otorgó');
select ok(
  (select m.puntos = 10 and m.vinculo = 'modulos_completados' and m.clave_unica = 'modulo:' || mc.id
   from public.movimientos_puntos m
   join public.modulos_completados mc on mc.id::text = m.vinculo_id
   join public.modulos mo on mo.id = mc.modulo_id
   where mc.aliado_id = 'a2000000-0000-0000-0000-000000000001' and mo.codigo = 't10'),
  'el movimiento vale lo del módulo y su clave es modulo:{id}'
);

-- B: ejemplo del CLAUDE.md (8 módulos de 5 → 20 este mes y 20 el siguiente) ------------------------------------

select pg_temp.completar('b2000000-0000-0000-0000-000000000001', 'm' || i, 100 - i) from generate_series(1, 8) i;
select is((select count(*) from public.modulos_completados where aliado_id = 'b2000000-0000-0000-0000-000000000001' and recompensa_estado = 'otorgada'),
  4::bigint, '8 módulos de 5: se otorgan 4 este mes');
select is(pg_temp.estado('b2000000-0000-0000-0000-000000000001', 'm5'), 'pendiente', 'los que llegaron después quedan pendientes');
select is(pg_temp.disponibles('b2000000-0000-0000-0000-000000000001'), 20, '20 puntos este mes');

select is(interno.otorgar_modulos_todos(pg_temp.mes_siguiente()) >= 20, true, 'el cron del día 1 otorga los pendientes');
select is(pg_temp.disponibles('b2000000-0000-0000-0000-000000000001'), 40, '40 puntos al cabo de dos meses');
select is(public.otorgar_modulos_pendientes('b2000000-0000-0000-0000-000000000001', pg_temp.mes_siguiente()), 0,
  'volver a correrlo no otorga nada más');

-- C: registro desde el Hub (completar_modulo) -----------------------------------------------------------------

select is(public.completar_modulo('c2000000-0000-0000-0000-000000000001', 'c13') ->> 'recompensa_estado', 'no_aplica',
  'un curso sin puntos queda como no_aplica');
select is((select count(*) from public.movimientos_puntos where aliado_id = 'c2000000-0000-0000-0000-000000000001'), 0::bigint,
  'y no genera movimientos');

select is(public.completar_modulo('c2000000-0000-0000-0000-000000000001', 'c11') ->> 'recompensa_estado', 'otorgada',
  'un curso con puntos se otorga al completarlo');
select is((public.completar_modulo('c2000000-0000-0000-0000-000000000001', 'c11') ->> 'nuevo')::boolean, false,
  'completarlo otra vez no cambia nada');
select is(pg_temp.disponibles('c2000000-0000-0000-0000-000000000001'), 5, 'y no suma de nuevo');

update public.modulos set puntos = 10 where codigo = 'c11';
select is((select mc.puntos from public.modulos_completados mc join public.modulos m on m.id = mc.modulo_id
           where mc.aliado_id = 'c2000000-0000-0000-0000-000000000001' and m.codigo = 'c11'), 5,
  'cambiar el valor del catálogo no altera lo ya completado');

select throws_ok($$select public.completar_modulo('c2000000-0000-0000-0000-000000000001', 'no-existe')$$,
  'P0001', 'modulo_inexistente: el módulo no existe o no está disponible', 'un código desconocido se rechaza');
select throws_ok($$select public.completar_modulo('c2000000-0000-0000-0000-000000000001', 'off')$$,
  'P0001', 'modulo_inexistente: el módulo no existe o no está disponible', 'un módulo inactivo se rechaza');

-- D: cuenta no activa ------------------------------------------------------------------------------------------

select throws_ok($$select public.completar_modulo('d2000000-0000-0000-0000-000000000001', 'c12')$$,
  'P0001', 'aliado_no_activo: la cuenta no está activa', 'una cuenta no activa no puede completar módulos desde el Hub');
select pg_temp.completar('d2000000-0000-0000-0000-000000000001', 'c12', 5);
select is(pg_temp.estado('d2000000-0000-0000-0000-000000000001', 'c12'), 'pendiente', 'sin cuenta activa, la recompensa queda pendiente');
update public.aliados set estado = 'activo' where id = 'd2000000-0000-0000-0000-000000000001';
select is(pg_temp.estado('d2000000-0000-0000-0000-000000000001', 'c12'), 'otorgada', 'al activarse la cuenta se otorga');

-- Programación y privilegios ------------------------------------------------------------------------------------

select is((select schedule from cron.job where jobname = 'otorgar-modulos-mensual'), '5 5 1 * *',
  'el otorgamiento mensual se programa el día 1 a las 00:05 hora Bogotá (05:05 UTC)');
select ok(not has_function_privilege('authenticated', 'public.completar_modulo(uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.otorgar_modulos_pendientes(uuid, timestamptz)', 'execute'),
  'el navegador no puede registrar módulos ni otorgar puntos directamente');

select * from finish();
rollback;
