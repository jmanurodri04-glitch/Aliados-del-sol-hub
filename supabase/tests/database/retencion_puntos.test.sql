-- Tests de puntos retenidos mientras la cuenta no está activa (decisión del equipo, CLAUDE.md §5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.aliado(id uuid, email text)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Prueba Retención', 'celular', '+573001234567', 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
$$;

create function pg_temp.mov(aliado uuid, motivo text, clave text, puntos integer default null)
returns void language sql as $$
  insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, clave_unica, creado_por, fecha)
  select mov.aliado, coalesce(r.tipo, 'ganado'), mov.puntos, mov.motivo, 'empresas', mov.clave, 'webhook_clientify',
         now() - interval '10 days'
  from public.reglas_puntos r where r.motivo = mov.motivo
  on conflict (clave_unica) do nothing;
$$;

create function pg_temp.en_libro(aliado uuid) returns bigint language sql as $$
  select count(*) from public.movimientos_puntos m where m.aliado_id = aliado;
$$;
create function pg_temp.retenidos(aliado uuid) returns bigint language sql as $$
  select count(*) from public.movimientos_retenidos m where m.aliado_id = aliado;
$$;

-- S: aliado activo que luego se suspende. P: aliado aún pendiente de aprobación.
select pg_temp.aliado('50000000-0000-0000-0000-000000000005', 's@retencion.test');
select pg_temp.aliado('70000000-0000-0000-0000-000000000007', 'p@retencion.test');
update public.aliados set estado = 'activo' where id = '50000000-0000-0000-0000-000000000005';
select pg_temp.mov('50000000-0000-0000-0000-000000000005', 'registro_valido', 's:1');
update public.aliados set estado = 'suspendido' where id = '50000000-0000-0000-0000-000000000005';

-- Mientras está suspendido ---------------------------------------------------------------

select pg_temp.mov('50000000-0000-0000-0000-000000000005', 'empresa_calificada', 's:2');
select pg_temp.mov('50000000-0000-0000-0000-000000000005', 'referido_imperfecto', 's:3');
select is(pg_temp.en_libro('50000000-0000-0000-0000-000000000005'), 1::bigint, 'suspendido: lo nuevo no entra al libro mayor');
select is(pg_temp.retenidos('50000000-0000-0000-0000-000000000005'), 2::bigint, 'suspendido: ganancias y penalizaciones quedan retenidas');
select row_eq($$select puntos_disponibles, puntos_nivel from public.aliados where id = '50000000-0000-0000-0000-000000000005'$$,
  row(10, 10), 'suspendido: el saldo no cambia');

select pg_temp.mov('50000000-0000-0000-0000-000000000005', 'empresa_calificada', 's:2');
select is(pg_temp.retenidos('50000000-0000-0000-0000-000000000005'), 2::bigint, 'un webhook repetido no duplica el retenido');

select pg_temp.mov('50000000-0000-0000-0000-000000000005', 'registro_valido', 's:1');
select is(pg_temp.retenidos('50000000-0000-0000-0000-000000000005'), 2::bigint, 'una clave que ya está en el libro no se retiene de nuevo');

select throws_ok($$insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, clave_unica, creado_por)
  values ('50000000-0000-0000-0000-000000000005', 'redimido', 5, 'canje', 'canjes', 'canje:s1', 'canjes_api')$$,
  'P0001', null, 'suspendido: no puede canjear');

insert into public.movimientos_puntos (aliado_id, tipo, puntos, motivo, vinculo, clave_unica, creado_por, nota)
  values ('50000000-0000-0000-0000-000000000005', 'ganado', 7, 'ajuste_admin', 'ajuste_admin', 'ajuste:s1',
          'admin:00000000-0000-0000-0000-000000000000', 'Corrección');
select is(pg_temp.en_libro('50000000-0000-0000-0000-000000000005'), 2::bigint, 'un ajuste de admin se aplica aunque esté suspendido');

-- Al reactivarse ------------------------------------------------------------------------------

update public.aliados set estado = 'activo' where id = '50000000-0000-0000-0000-000000000005';
select is(pg_temp.retenidos('50000000-0000-0000-0000-000000000005'), 0::bigint, 'al reactivarse no quedan retenidos');
select is(pg_temp.en_libro('50000000-0000-0000-0000-000000000005'), 4::bigint, 'al reactivarse los retenidos pasan al libro mayor');
select results_eq(
  $$select clave_unica from public.movimientos_puntos
    where aliado_id = '50000000-0000-0000-0000-000000000005' order by secuencia$$,
  array['s:1', 'ajuste:s1', 's:2', 's:3'],
  'se acreditan en su orden original, después de lo ya aplicado'
);
select row_eq($$select puntos_disponibles, puntos_nivel from public.aliados where id = '50000000-0000-0000-0000-000000000005'$$,
  row(42, 42), 'el saldo se recalcula: 10 + 7 + 30 − 5 = 42');
select ok(
  (select fecha > now() - interval '1 minute' and nota like '%Retenido mientras la cuenta estaba suspendido%'
   from public.movimientos_puntos where clave_unica = 's:2'),
  'cuentan desde la reactivación y la nota indica la retención'
);

-- Cuenta pendiente de aprobación ---------------------------------------------------------------

select pg_temp.mov('70000000-0000-0000-0000-000000000007', 'registro_valido', 'p:1');
select row_eq($$select pg_temp.en_libro('70000000-0000-0000-0000-000000000007'), pg_temp.retenidos('70000000-0000-0000-0000-000000000007')$$,
  row(0::bigint, 1::bigint), 'pendiente: el movimiento queda retenido');
update public.aliados set estado = 'activo', aprobado_at = now() where id = '70000000-0000-0000-0000-000000000007';
select row_eq($$select puntos_disponibles, nivel::text from public.aliados where id = '70000000-0000-0000-0000-000000000007'$$,
  row(10, 'bronce'::text), 'al aprobarse la cuenta se acredita lo retenido');

-- Visibilidad -----------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "50000000-0000-0000-0000-000000000005", "role": "authenticated"}', true);
select is((select count(*) from public.movimientos_retenidos), 0::bigint, 'un aliado no ve la tabla de retenidos (solo admin)');
select throws_ok($$update public.movimientos_retenidos set puntos = 1$$, '42501', null,
  'un aliado no puede modificar los retenidos');
reset role;

select * from finish();
rollback;
