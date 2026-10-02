-- Tests del catálogo de recompensas, los canjes por API y su anulación (CLAUDE.md §4.10, §5.4, §10), y de la
-- exclusión de las cuentas de admin de la sincronización con Clientify (§8, flujo A).
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

create function pg_temp.aliado(id uuid, email text, tipo text default 'emi')
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Prueba Canjes ' || tipo, 'celular', '+5730' || lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0'), 'tipo_aliado', tipo,
    'organizacion', 'Org', 'cargo', 'Cargo', 'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
$$;
create function pg_temp.cod(id uuid) returns text language sql as $$ select codigo_aliado from public.aliados where aliados.id = cod.id; $$;
create function pg_temp.saldo(id uuid) returns integer language sql as $$ select puntos_disponibles from public.aliados where aliados.id = saldo.id; $$;
create function pg_temp.pnivel(id uuid) returns integer language sql as $$ select puntos_nivel from public.aliados where aliados.id = pnivel.id; $$;
create function pg_temp.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
-- El nivel lo recalcula la base; para probar el requisito de nivel se fija a mano después de cada movimiento.
create function pg_temp.nivel(id uuid, n public.nivel) returns void language sql as $$ update public.aliados set nivel = n where aliados.id = nivel.id; $$;

-- Z: admin · A: aliado activo · B: solicitud pendiente · C: aliado activo · Y: otro admin
select pg_temp.aliado('ac000000-0000-0000-0000-00000000000a', 'z@canjes.test');
select pg_temp.aliado('ac000000-0000-0000-0000-000000000001', 'a@canjes.test');
select pg_temp.aliado('ac000000-0000-0000-0000-000000000002', 'b@canjes.test');
select pg_temp.aliado('ac000000-0000-0000-0000-000000000003', 'c@canjes.test');
select pg_temp.aliado('ac000000-0000-0000-0000-00000000000b', 'y@canjes.test');
update public.aliados set estado = 'activo', rol = 'admin' where id in ('ac000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-00000000000b');
update public.aliados set estado = 'activo' where id in ('ac000000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000003');
select public.admin_ajuste_puntos('ac000000-0000-0000-0000-00000000000a', pg_temp.cod('ac000000-0000-0000-0000-000000000001'), 300, 'Saldo inicial de prueba', 'bc000000-0000-0000-0000-000000000001');

-- Permisos ----------------------------------------------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'public.registrar_canje(text, text, text, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.consultar_canjes(text, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.admin_anular_canje(uuid, uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.admin_guardar_recompensa(uuid, uuid, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.registrar_canje(text, text, text, text)', 'execute'),
  'el navegador no puede canjear, consultar ni administrar el catálogo directamente');
select ok(not has_table_privilege('anon', 'public.recompensas', 'select')
      and not has_table_privilege('authenticated', 'public.recompensas', 'insert')
      and not has_table_privilege('anon', 'public.v_recompensas', 'select')
      and not has_table_privilege('anon', 'public.v_mis_canjes', 'select'),
  'anon no lee el catálogo y authenticated no lo escribe');

-- Catálogo ------------------------------------------------------------------------------------------------------------

select throws_ok($$select public.admin_guardar_recompensa('ac000000-0000-0000-0000-000000000001', null, '{"codigo":"cafe","nombre":"Café","puntos":50}')$$,
  'P0001', 'no_autorizado: se requiere una cuenta de administrador activa', 'un aliado no crea recompensas');
select throws_ok($$select public.admin_guardar_recompensa('ac000000-0000-0000-0000-00000000000a', null, '{"codigo":"Café!","nombre":"Café","puntos":50}')$$,
  'P0001', 'dato_invalido: el código solo admite minúsculas, números, guion y guion bajo (2 a 40)', 'el código tiene un formato fijo');
select throws_ok($$select public.admin_guardar_recompensa('ac000000-0000-0000-0000-00000000000a', null, '{"codigo":"cafe","nombre":"Café","puntos":0}')$$,
  'P0001', 'dato_invalido: los puntos deben estar entre 1 y 100000', 'los puntos deben ser positivos');
select throws_ok($$select public.admin_guardar_recompensa('ac000000-0000-0000-0000-00000000000a', null, '{"codigo":"cafe","nombre":"Café","puntos":50,"nivel_minimo":"leyenda"}')$$,
  'P0001', 'dato_invalido: los puntos, el nivel o el estado no son válidos', 'el nivel debe existir');

select is(public.admin_guardar_recompensa('ac000000-0000-0000-0000-00000000000a', null,
  '{"codigo":"cafe","nombre":"Bono de café","puntos":50,"categoria":"Gastronomía"}') ->> 'codigo', 'cafe', 'el admin crea una recompensa');
select throws_ok($$select public.admin_guardar_recompensa('ac000000-0000-0000-0000-00000000000a', null, '{"codigo":"cafe","nombre":"Otro café","puntos":10}')$$,
  'P0001', 'estado_invalido: ya existe una recompensa con el código cafe', 'el código no se repite');
select public.admin_guardar_recompensa('ac000000-0000-0000-0000-00000000000a', null, '{"codigo":"cena","nombre":"Cena para dos","puntos":200,"nivel_minimo":"oro"}');
select public.admin_guardar_recompensa('ac000000-0000-0000-0000-00000000000a', null, '{"codigo":"solo-x","nombre":"Beneficio exclusivo","puntos":10,"proveedor":"prov-x"}');
select public.admin_guardar_recompensa('ac000000-0000-0000-0000-00000000000a', null, '{"codigo":"vieja","nombre":"Recompensa retirada","puntos":5,"activa":false}');

select is(public.admin_guardar_recompensa('ac000000-0000-0000-0000-00000000000a', (select id from public.recompensas where codigo = 'cafe'),
  '{"codigo":"otro","nombre":"Bono de café","puntos":60,"categoria":"Gastronomía"}') ->> 'codigo', 'cafe', 'al editar, el código no cambia aunque se envíe otro');
select is((select puntos from public.recompensas where codigo = 'cafe'), 60, 'la edición cambia los puntos');
select throws_ok($$update public.recompensas set codigo = 'cafe2' where codigo = 'cafe'$$,
  'P0001', 'dato_invalido: el código de una recompensa no se puede cambiar', 'el código es inmutable también por SQL');
select is((select count(*)::integer from public.acciones_admin where accion = 'guardar_recompensa'), 5, 'cada cambio del catálogo queda auditado');

-- Canjes ------------------------------------------------------------------------------------------------------------------

select is(public.registrar_canje('prov', lower(pg_temp.cod('ac000000-0000-0000-0000-000000000001')), 'cafe', 'R-1') ->> 'puntos',
  '60', 'el canje toma los puntos vigentes del catálogo');
select is(pg_temp.saldo('ac000000-0000-0000-0000-000000000001'), 240, 'descuenta el saldo disponible: 300 − 60');
select is(pg_temp.pnivel('ac000000-0000-0000-0000-000000000001'), 300, 'un canje no descuenta puntos de nivel');
select row_eq($$select m.tipo, m.motivo, m.creado_por, m.vinculo, m.nota from public.movimientos_puntos m
                 join public.canjes c on m.clave_unica = 'canje:' || c.id where c.referencia_externa = 'R-1' and c.proveedor = 'prov'$$,
  row('redimido'::text, 'canje'::text, 'canjes_api'::text, 'canjes'::text, 'Bono de café'::text), 'registra el movimiento redimido con la clave canje:{id}');

select is(public.registrar_canje('prov', pg_temp.cod('ac000000-0000-0000-0000-000000000001'), 'cafe', 'R-1') ->> 'duplicado',
  'true', 'la misma referencia del mismo proveedor devuelve el canje original');
select is(pg_temp.saldo('ac000000-0000-0000-0000-000000000001'), 240, 'y no descuenta dos veces');
select throws_ok($$select public.registrar_canje('prov', (select codigo_aliado from public.aliados where id = 'ac000000-0000-0000-0000-000000000001'), 'cena', 'R-1')$$,
  'P0001', 'referencia_duplicada: la referencia R-1 ya se usó en otro canje', 'la referencia no se reutiliza para otra recompensa');
select throws_ok($$select public.registrar_canje('prov', (select codigo_aliado from public.aliados where id = 'ac000000-0000-0000-0000-000000000003'), 'cafe', 'R-1')$$,
  'P0001', 'referencia_duplicada: la referencia R-1 ya se usó en otro canje', 'ni para otro aliado');
select is(public.registrar_canje('prov2', pg_temp.cod('ac000000-0000-0000-0000-000000000001'), 'cafe', 'R-1') ->> 'duplicado',
  'false', 'otro proveedor puede usar la misma referencia');
select is(pg_temp.saldo('ac000000-0000-0000-0000-000000000001'), 180, 'saldo tras el segundo canje: 240 − 60');

select throws_ok($$select public.registrar_canje('prov', (select codigo_aliado from public.aliados where id = 'ac000000-0000-0000-0000-000000000001'), 'cena', 'R-2')$$,
  'P0001', 'nivel_insuficiente: la recompensa requiere nivel oro y el aliado es bronce', 'el nivel actual debe alcanzar el mínimo de la recompensa');
select pg_temp.nivel('ac000000-0000-0000-0000-000000000001', 'oro');
select throws_ok($$select public.registrar_canje('prov', (select codigo_aliado from public.aliados where id = 'ac000000-0000-0000-0000-000000000001'), 'cena', 'R-2')$$,
  'P0001', 'saldo_insuficiente: la recompensa vale 200 puntos y el saldo disponible es 180', 'el saldo debe cubrir la recompensa');
select public.admin_ajuste_puntos('ac000000-0000-0000-0000-00000000000a', pg_temp.cod('ac000000-0000-0000-0000-000000000001'), 100, 'Saldo adicional de prueba', 'bc000000-0000-0000-0000-000000000002');
select pg_temp.nivel('ac000000-0000-0000-0000-000000000001', 'oro');
select is(public.registrar_canje('prov', pg_temp.cod('ac000000-0000-0000-0000-000000000001'), 'cena', 'R-2') ->> 'puntos_disponibles',
  '80', 'con nivel y saldo suficientes el canje procede: 280 − 200');
select is((select nivel_requerido::text from public.canjes where referencia_externa = 'R-2'), 'oro', 'el canje guarda el nivel exigido');

select throws_ok($$select public.registrar_canje('prov', (select codigo_aliado from public.aliados where id = 'ac000000-0000-0000-0000-000000000001'), 'solo-x', 'R-3')$$,
  'P0001', 'recompensa_inexistente: la recompensa no existe, no está activa o no corresponde a este proveedor', 'una recompensa de otro proveedor no se canjea');
select is(public.registrar_canje('prov-x', pg_temp.cod('ac000000-0000-0000-0000-000000000001'), 'solo-x', 'R-3') ->> 'puntos',
  '10', 'su proveedor sí la canjea');
select throws_ok($$select public.registrar_canje('prov', (select codigo_aliado from public.aliados where id = 'ac000000-0000-0000-0000-000000000001'), 'vieja', 'R-4')$$,
  'P0001', 'recompensa_inexistente: la recompensa no existe, no está activa o no corresponde a este proveedor', 'una recompensa inactiva no se canjea');
select throws_ok($$select public.registrar_canje('prov', (select codigo_aliado from public.aliados where id = 'ac000000-0000-0000-0000-000000000002'), 'cafe', 'R-5')$$,
  'P0001', 'aliado_no_activo: la cuenta no está activa', 'una cuenta pendiente no canjea');
select throws_ok($$select public.registrar_canje('prov', 'NOEXISTE123', 'cafe', 'R-6')$$,
  'P0001', 'aliado_inexistente: no existe un aliado con ese código', 'un código inexistente se rechaza');
select throws_ok($$select public.registrar_canje('prov', (select codigo_aliado from public.aliados where id = 'ac000000-0000-0000-0000-000000000001'), 'cafe', '')$$,
  'P0001', 'dato_invalido: la referencia externa debe tener entre 1 y 100 caracteres', 'la referencia es obligatoria');

-- Límite: 30 canjes por hora por aliado.
insert into public.canjes (aliado_id, puntos, recompensa, proveedor, referencia_externa)
select 'ac000000-0000-0000-0000-000000000003', 1, 'Prueba', 'prov', 'L-' || g from generate_series(1, 30) g;
select public.admin_ajuste_puntos('ac000000-0000-0000-0000-00000000000a', pg_temp.cod('ac000000-0000-0000-0000-000000000003'), 100, 'Saldo para el límite', 'bc000000-0000-0000-0000-000000000003');
select throws_ok($$select public.registrar_canje('prov', (select codigo_aliado from public.aliados where id = 'ac000000-0000-0000-0000-000000000003'), 'cafe', 'L-31')$$,
  'P0001', 'limite_canjes: máximo 30 canjes por hora', 'máximo 30 canjes por hora');

-- Consulta del proveedor ----------------------------------------------------------------------------------------------------

select is(public.consultar_canjes('prov', lower(pg_temp.cod('ac000000-0000-0000-0000-000000000001'))) - 'recompensas',
  jsonb_build_object('codigo_aliado', pg_temp.cod('ac000000-0000-0000-0000-000000000001'), 'activo', true, 'nivel', 'bronce', 'puntos_disponibles', 70),
  'la consulta devuelve estado, nivel y saldo, sin datos personales');
select is((select jsonb_agg(r ->> 'codigo' order by r ->> 'codigo') from jsonb_array_elements(public.consultar_canjes('prov', pg_temp.cod('ac000000-0000-0000-0000-000000000001')) -> 'recompensas') r),
  '["cafe", "cena"]'::jsonb, 'lista solo las recompensas activas de ese proveedor o de todos');
select is((select jsonb_object_agg(r ->> 'codigo', r -> 'disponible') from jsonb_array_elements(public.consultar_canjes('prov', pg_temp.cod('ac000000-0000-0000-0000-000000000001')) -> 'recompensas') r),
  '{"cafe": true, "cena": false}'::jsonb, 'marca cuáles puede canjear hoy (70 puntos)');
select is((select r ->> 'motivo' from jsonb_array_elements(public.consultar_canjes('prov', pg_temp.cod('ac000000-0000-0000-0000-000000000002')) -> 'recompensas') r limit 1),
  'aliado_no_activo', 'una cuenta pendiente no tiene recompensas disponibles');

-- Anulación -------------------------------------------------------------------------------------------------------------------

select throws_ok($$select public.admin_anular_canje('ac000000-0000-0000-0000-000000000003', (select id from public.canjes where referencia_externa = 'R-2'), 'El proveedor no entregó')$$,
  'P0001', 'no_autorizado: se requiere una cuenta de administrador activa', 'un aliado no anula canjes');
select throws_ok($$select public.admin_anular_canje('ac000000-0000-0000-0000-00000000000a', (select id from public.canjes where referencia_externa = 'R-2'), 'corto')$$,
  'P0001', 'dato_invalido: el motivo debe tener al menos 10 caracteres', 'anular exige un motivo');
select is(public.admin_anular_canje('ac000000-0000-0000-0000-00000000000a', (select id from public.canjes where referencia_externa = 'R-2'), 'El proveedor no entregó la cena') ->> 'puntos_devueltos',
  '200', 'el admin anula un canje');
select is(pg_temp.saldo('ac000000-0000-0000-0000-000000000001'), 270, 'la anulación devuelve el saldo: 70 + 200');
select is(pg_temp.pnivel('ac000000-0000-0000-0000-000000000001'), 400, 'la devolución no suma puntos de nivel (300 + 100 de ajustes)');
select row_eq($$select m.tipo, m.motivo, m.vinculo from public.movimientos_puntos m join public.canjes c on m.clave_unica = 'canje_anulado:' || c.id where c.referencia_externa = 'R-2'$$,
  row('ganado'::text, 'ajuste_admin'::text, 'canjes'::text), 'la devolución es un ajuste_admin vinculado al canje');
select throws_ok($$select public.admin_anular_canje('ac000000-0000-0000-0000-00000000000a', (select id from public.canjes where referencia_externa = 'R-2'), 'Segunda anulación de prueba')$$,
  'P0001', 'estado_invalido: el canje ya fue anulado', 'un canje no se anula dos veces');
select is((select count(*)::integer from public.acciones_admin where accion = 'anular_canje'), 1, 'la anulación queda auditada');
select throws_ok($$update public.canjes set puntos = 1 where referencia_externa = 'R-1' and proveedor = 'prov'$$,
  'P0001', 'canjes no se editan; un admin puede anularlos', 'un canje no se edita');
select throws_ok($$delete from public.canjes where referencia_externa = 'R-1' and proveedor = 'prov'$$,
  'P0001', 'canjes no se borran; un admin puede anularlos', 'ni se borra');

-- Vistas ------------------------------------------------------------------------------------------------------------------------

set local role authenticated;
select pg_temp.como('ac000000-0000-0000-0000-000000000001');
select is((select count(*)::integer from public.v_mis_canjes), 4, 'el aliado ve sus canjes');
select is((select estado from public.v_mis_canjes where recompensa = 'Cena para dos'), 'anulado', 'con el estado de la anulación');
select is((select array_agg(codigo order by codigo) from public.v_recompensas), array['cafe', 'cena', 'solo-x'], 've el catálogo activo');
select is((select count(*)::integer from public.v_admin_canjes), 0, 'un aliado no ve la vista de canjes del admin');
select pg_temp.como('ac000000-0000-0000-0000-000000000003');
select is((select count(*)::integer from public.v_mis_canjes where recompensa <> 'Prueba'), 0, 'otro aliado no ve esos canjes');
select pg_temp.como('ac000000-0000-0000-0000-00000000000a');
select is((select count(*)::integer from public.v_admin_canjes where codigo_aliado = pg_temp.cod('ac000000-0000-0000-0000-000000000001')), 4, 'el admin ve todos los canjes');
select is((select canjes_confirmados from public.v_admin_recompensas where codigo = 'cafe'), 2, 'y el uso de cada recompensa');
reset role;

-- Clientify: los admins no se sincronizan (flujo A) ---------------------------------------------------------------------------------

select is((select clientify_sync_estado from public.aliados where id = 'ac000000-0000-0000-0000-00000000000a'), 'excluido', 'una cuenta de admin queda excluida de Clientify');
select ok(not exists (select 1 from public.clientify_reclamar_aliados(50) r where r.codigo_aliado = pg_temp.cod('ac000000-0000-0000-0000-00000000000a')),
  'la cola del flujo A no reclama admins');
update public.aliados set rol = 'aliado' where id = 'ac000000-0000-0000-0000-00000000000b';
select is((select clientify_sync_estado from public.aliados where id = 'ac000000-0000-0000-0000-00000000000b'), 'pendiente', 'si deja de ser admin vuelve a la cola');

select * from finish();
rollback;
