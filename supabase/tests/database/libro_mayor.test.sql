-- Tests del libro mayor y los recálculos (CLAUDE.md §5, §5.1, §5.4, §6.1, §6.2, §6.3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Aliados de prueba, creados como en el registro real y activados.
create function pg_temp.aliado(id uuid, email text, tipo text)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Prueba ' || tipo, 'celular', '+573001234567', 'tipo_aliado', tipo,
    'organizacion', 'Org', 'cargo', 'Cargo', 'como_llega_empresas', 'Red',
    'autorizacion_datos', true, 'acepta_terminos', true));
  update public.aliados set estado = 'activo' where aliados.id = aliado.id;
$$;

-- Registra un movimiento como lo harán los endpoints: solo motivo y clave; la base completa el resto.
create function pg_temp.mov(aliado uuid, motivo text, clave text, fecha timestamptz default now(), puntos integer default null)
returns void language sql as $$
  insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, clave_unica, creado_por, fecha)
  select mov.aliado, coalesce(r.tipo, 'ganado'), mov.puntos, mov.motivo, 'empresas', mov.clave, 'sistema', mov.fecha
  from public.reglas_puntos r where r.motivo = mov.motivo
  on conflict (clave_unica) do nothing;
$$;

create function pg_temp.saldo(aliado uuid)
returns table (puntos_nivel integer, puntos_disponibles integer, nivel text) language sql as $$
  select a.puntos_nivel, a.puntos_disponibles, a.nivel::text from public.aliados a where a.id = aliado;
$$;

select pg_temp.aliado('a0000000-0000-0000-0000-00000000000a', 'a@libro.test', 'emi');
select pg_temp.aliado('b0000000-0000-0000-0000-00000000000b', 'b@libro.test', 'linker');
select pg_temp.aliado('c0000000-0000-0000-0000-00000000000c', 'c@libro.test', 'financiero');
select pg_temp.aliado('d0000000-0000-0000-0000-00000000000d', 'd@libro.test', 'cliente_embajador');

-- Reglas (§5) -------------------------------------------------------------------------

select is((select count(*) from public.reglas_puntos), 16::bigint, 'el catálogo tiene los 16 motivos');
select is((select puntos from public.reglas_puntos where motivo = 'racha_solar'), 75, 'la Racha Solar vale 75');
select is((select count(*) from public.reglas_puntos where motivo like '%disponible%'), 0::bigint, '"Información disponible" no existe');

select pg_temp.mov('a0000000-0000-0000-0000-00000000000a', 'registro_valido', 'a:1');
select is((select puntos from public.movimientos_puntos where clave_unica = 'a:1'), 10, 'sin indicar puntos, la base toma el valor de la regla (+10)');
select throws_ok($$select pg_temp.mov('a0000000-0000-0000-0000-00000000000a', 'registro_valido', 'a:2', now(), 50)$$,
  'P0001', null, 'un valor distinto al de la regla se rechaza');
select throws_ok($$insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, clave_unica, creado_por)
  values ('a0000000-0000-0000-0000-00000000000a', 'ganado', 20, 'informacion_disponible', 'empresas', 'a:3', 'sistema')$$,
  '23514', null, 'un motivo inexistente se rechaza');
select throws_ok($$select pg_temp.mov('a0000000-0000-0000-0000-00000000000a', 'ajuste_admin', 'a:4')$$,
  '23502', null, 'un ajuste de admin exige indicar los puntos');

-- Ejemplo del CLAUDE.md: +10, −30, +20 = 20 (piso en 0, sin memoria) -------------------------

select pg_temp.mov('b0000000-0000-0000-0000-00000000000b', 'registro_valido',   'b:1', now() - interval '3 days');
select pg_temp.mov('b0000000-0000-0000-0000-00000000000b', 'informacion_falsa', 'b:2', now() - interval '2 days');
select pg_temp.mov('b0000000-0000-0000-0000-00000000000b', 'referido_perfecto', 'b:3', now() - interval '1 day');

select is((select puntos_aplicados from public.movimientos_puntos where clave_unica = 'b:2'), 10,
  '−30 con saldo 10: se descontaron 10 (puntos_aplicados)');
select is(public.calcular_puntos_nivel('b0000000-0000-0000-0000-00000000000b'), 20, 'puntos_nivel: +10, −30, +20 → 20');
select is(public.calcular_puntos_disponibles('b0000000-0000-0000-0000-00000000000b'), 20, 'puntos_disponibles: 10 − 10 + 20 → 20');
select row_eq($$select * from pg_temp.saldo('b0000000-0000-0000-0000-00000000000b')$$, row(20, 20, 'bronce'::text),
  'la caché del aliado se recalcula sola al insertar');

-- El mismo ejemplo en un solo INSERT (misma fecha): el orden lo da `secuencia`.
insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, clave_unica, creado_por) values
  ('d0000000-0000-0000-0000-00000000000d', 'ganado',  'registro_valido',   'empresas', 'd:1', 'sistema'),
  ('d0000000-0000-0000-0000-00000000000d', 'perdido', 'informacion_falsa', 'empresas', 'd:2', 'sistema'),
  ('d0000000-0000-0000-0000-00000000000d', 'ganado',  'referido_perfecto', 'empresas', 'd:3', 'sistema');
select row_eq($$select puntos_nivel, puntos_disponibles from pg_temp.saldo('d0000000-0000-0000-0000-00000000000d')$$, row(20, 20),
  'con la misma fecha, el orden de inserción da el mismo resultado (20)');

-- Penalizaciones con saldo bajo: nunca negativo y sin deuda ---------------------------------

select pg_temp.mov('d0000000-0000-0000-0000-00000000000d', 'referido_imperfecto', 'd:4'); -- 20 − 5 = 15
select pg_temp.mov('d0000000-0000-0000-0000-00000000000d', 'informacion_falsa',   'd:5'); -- 15 − 15 = 0
select pg_temp.mov('d0000000-0000-0000-0000-00000000000d', 'fuera_perfil',        'd:6'); -- 0 − 0 = 0
select is(public.calcular_puntos_disponibles('d0000000-0000-0000-0000-00000000000d'), 0, 'el saldo disponible nunca es negativo');
select is((select puntos_aplicados from public.movimientos_puntos where clave_unica = 'd:6'), 0, 'una penalización con saldo 0 aplica 0');
select pg_temp.mov('d0000000-0000-0000-0000-00000000000d', 'referido_perfecto', 'd:7');
select is(public.calcular_puntos_disponibles('d0000000-0000-0000-0000-00000000000d'), 20, 'sin deuda: lo siguiente que gana suma completo');
select is(public.calcular_puntos_nivel('d0000000-0000-0000-0000-00000000000d'), 20, 'puntos_nivel también con piso: 20 → 15 → 0 → 0 → 20');

-- Ventana de 6 meses ------------------------------------------------------------------------

select pg_temp.mov('b0000000-0000-0000-0000-00000000000b', 'evento_validado', 'b:4', now() - interval '7 months');
select row_eq($$select puntos_nivel, puntos_disponibles from pg_temp.saldo('b0000000-0000-0000-0000-00000000000b')$$, row(20, 120),
  'un movimiento de hace 7 meses suma al saldo disponible pero no a puntos_nivel');
select is(public.calcular_puntos_nivel('b0000000-0000-0000-0000-00000000000b', now() + interval '7 months'), 0,
  'dentro de 7 meses todos los puntos de nivel habrán vencido');

-- Canjes -------------------------------------------------------------------------------------

select throws_ok($$insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, clave_unica, creado_por)
  values ('b0000000-0000-0000-0000-00000000000b', 'redimido', 500, 'canje', 'canjes', 'canje:1', 'canjes_api')$$,
  'P0001', null, 'no se puede redimir más que el saldo disponible');
insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, clave_unica, creado_por)
  values ('b0000000-0000-0000-0000-00000000000b', 'redimido', 100, 'canje', 'canjes', 'canje:2', 'canjes_api');
select row_eq($$select puntos_nivel, puntos_disponibles from pg_temp.saldo('b0000000-0000-0000-0000-00000000000b')$$, row(20, 20),
  'un canje descuenta del disponible y no toca puntos_nivel');

-- Idempotencia (§5.1) -------------------------------------------------------------------------

select pg_temp.mov('b0000000-0000-0000-0000-00000000000b', 'registro_valido', 'b:1');
select row_eq($$select (select count(*) from public.movimientos_puntos where clave_unica = 'b:1'),
                       (select puntos_disponibles from public.aliados where id = 'b0000000-0000-0000-0000-00000000000b')$$,
  row(1::bigint, 20), 'un movimiento repetido (misma clave) no se registra ni cambia el saldo');

-- Calidad y nivel (§6) -------------------------------------------------------------------------

insert into public.empresas (id, aliado_id, origen, empresa, sector, nombre_contacto, telefono, correo, valor_factura, es_perfecto) values
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'hub', 'E1', 'Industrial', 'C1', '3', 'e1@x.test', 1, true),
  ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000c', 'hub', 'E2', 'Industrial', 'C2', '3', 'e2@x.test', 1, true);
insert into public.avance_empresa (empresa_id) values
  ('e0000000-0000-0000-0000-000000000001'), ('e0000000-0000-0000-0000-000000000002');

select is((select calidad_referidos from public.aliados where id = 'c0000000-0000-0000-0000-00000000000c'), null,
  'sin empresas evaluables, calidad_referidos es NULL');

update public.avance_empresa set calificado = 'si', perfecto = 'si', oportunidad_tecnica = 'si', integridad_informacion = 'si'
  where empresa_id = 'e0000000-0000-0000-0000-000000000001';
select is((select calidad_referidos from public.aliados where id = 'c0000000-0000-0000-0000-00000000000c'), 100.00,
  'la empresa en revisión queda fuera del promedio: calidad 100');

select pg_temp.mov('c0000000-0000-0000-0000-00000000000c', 'evento_validado', 'c:1');
select is((select nivel::text from public.aliados where id = 'c0000000-0000-0000-0000-00000000000c'), 'plata', '100 pts y calidad 100 → plata');

select pg_temp.mov('c0000000-0000-0000-0000-00000000000c', 'negocio_cerrado', 'c:2');
select is((select nivel::text from public.aliados where id = 'c0000000-0000-0000-0000-00000000000c'), 'oro', '250 pts y calidad 100 → oro');

update public.avance_empresa set calificado = 'no', perfecto = 'no', oportunidad_tecnica = 'no', integridad_informacion = 'no'
  where empresa_id = 'e0000000-0000-0000-0000-000000000002';
select row_eq($$select calidad_referidos, nivel::text from public.aliados where id = 'c0000000-0000-0000-0000-00000000000c'$$,
  row(50.00::numeric(5,2), 'plata'::text), 'una empresa en 0 baja la calidad a 50 y el nivel a plata (manda la calidad)');

update public.avance_empresa set oportunidad_tecnica = 'revision' where empresa_id = 'e0000000-0000-0000-0000-000000000002';
select is((select nivel::text from public.aliados where id = 'c0000000-0000-0000-0000-00000000000c'), 'oro',
  'si esa empresa vuelve a revisión, sale del promedio y el nivel vuelve a oro');

delete from public.empresas where aliado_id = 'c0000000-0000-0000-0000-00000000000c';
select row_eq($$select calidad_referidos, nivel::text from public.aliados where id = 'c0000000-0000-0000-0000-00000000000c'$$,
  row(null::numeric(5,2), 'bronce'::text), 'sin empresas evaluables la calidad cuenta como 0: bronce aunque tenga 250 pts');

-- Recálculo diario ---------------------------------------------------------------------------

select is((select schedule from cron.job where jobname = 'recalcular-puntos-diario'), '15 5 * * *',
  'el cron diario corre a las 00:15 hora Bogotá (05:15 UTC)');

update public.aliados set puntos_nivel = 999, puntos_disponibles = 999, nivel = 'diamante' where id = 'c0000000-0000-0000-0000-00000000000c';
select interno.recalcular_todos();
select row_eq($$select * from pg_temp.saldo('c0000000-0000-0000-0000-00000000000c')$$, row(250, 250, 'bronce'::text),
  'recalcular_todos corrige cualquier caché desactualizada');

-- Permisos ------------------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.calcular_puntos_disponibles(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'interno.recalcular_aliado(uuid)', 'execute')
  and not has_function_privilege('anon', 'interno.recalcular_todos()', 'execute'),
  'el navegador no puede ejecutar cálculos ni recálculos'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "a0000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);
select is((select count(*) from public.reglas_puntos), 16::bigint, 'un aliado puede leer las reglas de puntos');
select throws_ok($$update public.reglas_puntos set puntos = 1000 where motivo = 'registro_valido'$$,
  '42501', null, 'un aliado no puede cambiar las reglas');
reset role;

select * from finish();
rollback;
