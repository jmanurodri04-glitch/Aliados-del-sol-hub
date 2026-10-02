-- Tests del canje con QR (fase 11): fichas de 5 minutos y un solo uso, operadores invitados por un admin,
-- reglas del canje compartidas con POST /api/canjes y que nada exponga aliados.id.
begin;
create extension if not exists pgtap with schema extensions;
select plan(79);

create function pg_temp.aliado(id uuid, email text, nombre text)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', nombre, 'celular', '+5730' || lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0'), 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
$$;
create function pg_temp.cod(id uuid) returns text language sql as $$ select codigo_aliado from public.aliados where aliados.id = cod.id; $$;
create function pg_temp.saldo(id uuid) returns integer language sql as $$ select puntos_disponibles from public.aliados where aliados.id = saldo.id; $$;
create function pg_temp.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
-- Guarda el último QR generado por el usuario de la sesión.
create temp table qr (n serial, ficha text, codigo text) on commit drop;
create function pg_temp.nuevo_qr() returns jsonb language plpgsql as $$
declare r jsonb := public.generar_qr_canje();
begin
  insert into qr (ficha, codigo) values (r ->> 'ficha', r ->> 'codigo_corto');
  return r;
end; $$;
create function pg_temp.ficha() returns text language sql as $$ select ficha from qr order by n desc limit 1; $$;
create function pg_temp.codigo() returns text language sql as $$ select codigo from qr order by n desc limit 1; $$;

-- Z: admin · A: aliado activo (300 pts) · B: solicitud pendiente · C: aliado activo que también será operador
select pg_temp.aliado('ad000000-0000-0000-0000-00000000000a', 'z@qr.test', 'Zoe Admin');
select pg_temp.aliado('ad000000-0000-0000-0000-000000000001', 'a@qr.test', 'Laura Pérez Gómez');
select pg_temp.aliado('ad000000-0000-0000-0000-000000000002', 'b@qr.test', 'Beto Pendiente');
select pg_temp.aliado('ad000000-0000-0000-0000-000000000003', 'c@qr.test', 'Carla Doble');
update public.aliados set estado = 'activo', rol = 'admin' where id = 'ad000000-0000-0000-0000-00000000000a';
update public.aliados set estado = 'activo' where id in ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000003');
select public.admin_ajuste_puntos('ad000000-0000-0000-0000-00000000000a', pg_temp.cod('ad000000-0000-0000-0000-000000000001'), 300,
  'Saldo inicial de prueba', 'bd000000-0000-0000-0000-000000000001');
select public.admin_ajuste_puntos('ad000000-0000-0000-0000-00000000000a', pg_temp.cod('ad000000-0000-0000-0000-00000000000a'), 100,
  'Saldo inicial de prueba', 'bd000000-0000-0000-0000-000000000002');
select public.admin_ajuste_puntos('ad000000-0000-0000-0000-00000000000a', pg_temp.cod('ad000000-0000-0000-0000-000000000003'), 100,
  'Saldo inicial de prueba', 'bd000000-0000-0000-0000-000000000003');
select public.admin_guardar_recompensa('ad000000-0000-0000-0000-00000000000a', null, '{"codigo":"qr-cafe","nombre":"Bono de café","puntos":50}');
select public.admin_guardar_recompensa('ad000000-0000-0000-0000-00000000000a', null, '{"codigo":"qr-cena","nombre":"Cena para dos","puntos":200,"nivel_minimo":"oro"}');
select public.admin_guardar_recompensa('ad000000-0000-0000-0000-00000000000a', null, '{"codigo":"qr-otro","nombre":"Beneficio de otro","puntos":10,"proveedor":"otro"}');
select public.admin_guardar_recompensa('ad000000-0000-0000-0000-00000000000a', null, '{"codigo":"qr-viaje","nombre":"Viaje solar","puntos":1000}');

-- Permisos ------------------------------------------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.generar_qr_canje()', 'execute')
      and has_function_privilege('authenticated', 'public.consultar_qr_canje(text)', 'execute')
      and has_function_privilege('authenticated', 'public.canjear_qr(text, text)', 'execute')
      and not has_function_privilege('anon', 'public.generar_qr_canje()', 'execute')
      and not has_function_privilege('anon', 'public.canjear_qr(text, text)', 'execute')
      and not has_function_privilege('anon', 'public.consultar_qr_canje(text)', 'execute'),
  'las funciones del QR exigen sesión (authenticated) y anon no las ejecuta');
select ok(not has_function_privilege('authenticated', 'public.admin_invitar_operador(uuid, jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.admin_estado_operador(uuid, uuid, boolean, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.registrar_canje(text, text, text, text)', 'execute')
      and not has_function_privilege('authenticated', 'interno.registrar_canje_base(text, text, text, text, uuid, text)', 'execute'),
  'el navegador no invita operadores ni llama la lógica de canje directamente');
select ok(not has_table_privilege('authenticated', 'public.canjes_qr', 'select')
      and not has_table_privilege('authenticated', 'public.canjes_qr_intentos', 'select')
      and not has_table_privilege('anon', 'public.operadores', 'select')
      and not has_table_privilege('authenticated', 'public.operadores', 'insert'),
  'las fichas y los intentos no se leen desde el navegador; los operadores no se escriben');
select ok((select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.operadores'::regclass, 'public.canjes_qr'::regclass, 'public.canjes_qr_intentos'::regclass)),
  'RLS activo en las tablas nuevas');

-- Invitar operadores ----------------------------------------------------------------------------------------------------

select throws_ok($$select public.admin_invitar_operador('ad000000-0000-0000-0000-000000000001', '{"correo":"o@qr.test","nombre":"Oscar Operador","proveedor":"geenera"}')$$,
  'P0001', 'no_autorizado: se requiere una cuenta de administrador activa', 'un aliado no invita operadores');
select throws_ok($$select public.admin_invitar_operador('ad000000-0000-0000-0000-00000000000a', '{"correo":"no-es-correo","nombre":"Oscar Operador","proveedor":"geenera"}')$$,
  'P0001', 'dato_invalido: el correo no es válido', 'el correo se valida');
select throws_ok($$select public.admin_invitar_operador('ad000000-0000-0000-0000-00000000000a', '{"correo":"o@qr.test","nombre":"Oscar Operador","proveedor":"GEENERA S.A."}')$$,
  'P0001', 'dato_invalido: el proveedor solo admite minúsculas, números, guion y guion bajo', 'el proveedor tiene formato fijo');
select is(public.admin_invitar_operador('ad000000-0000-0000-0000-00000000000a', '{"correo":"O@qr.test","nombre":"Oscar Operador","proveedor":"geenera"}') ->> 'cuenta',
  'nueva', 'invitar un correo sin cuenta pide una cuenta nueva');
select is(public.admin_invitar_operador('ad000000-0000-0000-0000-00000000000a', '{"correo":"p@qr.test","nombre":"Pía Proveedora","proveedor":"prov-x"}') ->> 'cuenta',
  'nueva', 'se invita a una operadora de otro proveedor');
select public.admin_invitar_operador('ad000000-0000-0000-0000-00000000000a', '{"correo":"q@qr.test","nombre":"Quique Inactivo","proveedor":"geenera"}');

-- La cuenta se crea con el enlace de invitación (sin datos de aliado): queda como operador, no como aliado.
insert into auth.users (id, email, raw_user_meta_data) values ('ad000000-0000-0000-0000-0000000000a1', 'o@qr.test', '{}');
insert into auth.users (id, email, raw_user_meta_data) values ('ad000000-0000-0000-0000-0000000000a2', 'p@qr.test', '{}');
insert into auth.users (id, email, raw_user_meta_data) values ('ad000000-0000-0000-0000-0000000000a3', 'q@qr.test', '{}');
select is((select usuario_id from public.operadores where correo = 'o@qr.test'), 'ad000000-0000-0000-0000-0000000000a1'::uuid,
  'la cuenta invitada queda vinculada al operador');
select ok(not exists (select 1 from public.aliados where id = 'ad000000-0000-0000-0000-0000000000a1'), 'un operador invitado no es aliado');
select throws_like($$insert into auth.users (id, email, raw_user_meta_data) values ('ad000000-0000-0000-0000-0000000000a9', 'x@qr.test', '{}')$$,
  '%registro_invalido%', 'un correo sin invitación sigue exigiendo los datos de aliado');
select is(public.admin_invitar_operador('ad000000-0000-0000-0000-00000000000a', '{"correo":"c@qr.test","nombre":"Carla Doble","proveedor":"geenera"}') ->> 'cuenta',
  'aliado', 'un aliado puede ser operador y entra con su contraseña del Hub');
select is((select usuario_id from public.operadores where correo = 'c@qr.test'), 'ad000000-0000-0000-0000-000000000003'::uuid,
  'el aliado queda vinculado como operador');
select is(public.admin_invitar_operador('ad000000-0000-0000-0000-00000000000a', '{"correo":"o@qr.test","nombre":"Oscar Operador","proveedor":"geenera"}') ->> 'cuenta',
  'operador', 'reinvitar a quien no ha creado su contraseña da un enlace nuevo');
update auth.users set encrypted_password = 'hash-de-prueba' where id = 'ad000000-0000-0000-0000-0000000000a1';
select throws_ok($$select public.admin_invitar_operador('ad000000-0000-0000-0000-00000000000a', '{"correo":"o@qr.test","nombre":"Oscar Operador","proveedor":"geenera"}')$$,
  'P0001', 'estado_invalido: o@qr.test ya es operador', 'no se reinvita a un operador activo con contraseña');
select throws_ok($$select public.admin_estado_operador('ad000000-0000-0000-0000-00000000000a', (select id from public.operadores where correo = 'q@qr.test'), false, '')$$,
  'P0001', 'dato_invalido: el motivo debe tener al menos 5 caracteres', 'desactivar exige motivo');
select is(public.admin_estado_operador('ad000000-0000-0000-0000-00000000000a', (select id from public.operadores where correo = 'q@qr.test'), false, 'Ya no trabaja con el proveedor') ->> 'activo',
  'false', 'el admin desactiva a un operador');
select is((select count(*)::integer from public.acciones_admin where accion in ('invitar_operador', 'estado_operador')), 6,
  'cada invitación y cambio de estado queda auditado');

-- Generar el QR (aliado) --------------------------------------------------------------------------------------------------

select pg_temp.como('ad000000-0000-0000-0000-000000000002');
select throws_ok($$select public.generar_qr_canje()$$, 'P0001', 'aliado_no_activo: la cuenta no está activa', 'una cuenta pendiente no genera QR');
select pg_temp.como('ad000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.generar_qr_canje()$$, 'P0001', 'aliado_inexistente: esta cuenta no es de un aliado', 'un operador no genera QR');
select pg_temp.como(null);
select throws_ok($$select public.generar_qr_canje()$$, 'P0001', 'aliado_inexistente: esta cuenta no es de un aliado', 'sin sesión no hay QR');

select pg_temp.como('ad000000-0000-0000-0000-000000000001');
select ok((select (r ->> 'ficha') ~ '^[A-Za-z0-9_-]{43}$' and (r ->> 'codigo_corto') ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'
                  and (r ->> 'vence_en')::integer = 300 and (r ->> 'codigo_aliado') = pg_temp.cod('ad000000-0000-0000-0000-000000000001')
           from pg_temp.nuevo_qr() r),
  'el QR trae una ficha de 43 caracteres, un código corto de 8 y vale 5 minutos');
select ok(not exists (select 1 from public.canjes_qr q join qr on true where q.ficha_hash = convert_to(qr.ficha, 'UTF8')),
  'la base guarda la huella de la ficha, nunca la ficha');
select is((select vence_at - creado_at from public.canjes_qr where aliado_id = 'ad000000-0000-0000-0000-000000000001' order by creado_at desc limit 1),
  interval '5 minutes', 'cada QR vence a los 5 minutos');
select ok(position('ad000000-0000-0000-0000-000000000001' in public.generar_qr_canje()::text) = 0, 'la respuesta no incluye aliados.id');
select pg_temp.nuevo_qr();
select is((select count(*)::integer from public.canjes_qr where aliado_id = 'ad000000-0000-0000-0000-000000000001' and anulado_at is null and usado_at is null), 1,
  'un QR nuevo anula los anteriores: solo uno sigue en juego');
select is(public.estado_qr_canje(lower(pg_temp.codigo())) ->> 'estado', 'vigente', 'el Hub ve su QR vigente');
select is(public.estado_qr_canje((select codigo from qr where n = 1)) ->> 'estado', 'reemplazado', 'y el anterior como reemplazado');

-- Consultar (operador) ----------------------------------------------------------------------------------------------------

select pg_temp.como('ad000000-0000-0000-0000-000000000001');
select throws_ok(format('select public.consultar_qr_canje(%L)', pg_temp.ficha()), 'P0001',
  'no_autorizado: esta cuenta no puede registrar canjes', 'un aliado común no puede consultar QR');
select pg_temp.como('ad000000-0000-0000-0000-0000000000a3');
select throws_ok(format('select public.consultar_qr_canje(%L)', pg_temp.ficha()), 'P0001',
  'no_autorizado: esta cuenta no puede registrar canjes', 'un operador desactivado no puede consultar');

select pg_temp.como('ad000000-0000-0000-0000-0000000000a1');
select is(public.perfil_operador() ->> 'proveedor', 'geenera', 'el operador ve su proveedor');
select is(public.consultar_qr_canje((select ficha from qr where n = 1)) ->> 'codigo', 'qr_reemplazado', 'un QR reemplazado (captura vieja) no sirve');
select ok((select (r ->> 'ok')::boolean and r -> 'aliado' ->> 'codigo_aliado' = pg_temp.cod('ad000000-0000-0000-0000-000000000001')
                  and r -> 'aliado' ->> 'nombre' = 'Laura P.' and (r -> 'aliado' ->> 'puntos_disponibles')::integer = 300
           from public.consultar_qr_canje(pg_temp.ficha()) r),
  'al escanear el operador ve código, nombre corto ("Laura P.") y saldo');
select ok(position('ad000000-0000-0000-0000-000000000001' in public.consultar_qr_canje(pg_temp.ficha())::text) = 0
      and position('a@qr.test' in public.consultar_qr_canje(pg_temp.ficha())::text) = 0,
  'la consulta no expone aliados.id ni el correo');
select is((select jsonb_agg(x ->> 'codigo' order by x ->> 'codigo') from jsonb_array_elements(public.consultar_qr_canje(pg_temp.ficha()) -> 'recompensas') x),
  '["qr-cafe", "qr-cena", "qr-viaje"]'::jsonb, 'solo aparecen las recompensas de su proveedor');
select is((select x ->> 'motivo' from jsonb_array_elements(public.consultar_qr_canje(pg_temp.ficha()) -> 'recompensas') x where x ->> 'codigo' = 'qr-cena'),
  'nivel_insuficiente', 'las no disponibles traen el motivo');
select is(public.consultar_qr_canje(lower(substr(pg_temp.codigo(), 1, 4)) || '-' || lower(substr(pg_temp.codigo(), 5))) -> 'aliado' ->> 'codigo_aliado',
  pg_temp.cod('ad000000-0000-0000-0000-000000000001'), 'el código corto se acepta en minúscula y con guion');

-- Canjear ------------------------------------------------------------------------------------------------------------------

select throws_ok(format('select public.canjear_qr(%L, %L)', pg_temp.ficha(), 'qr-cena'), 'P0001',
  'nivel_insuficiente: la recompensa requiere nivel oro y el aliado es bronce', 'se mantiene la regla de nivel');
select throws_ok(format('select public.canjear_qr(%L, %L)', pg_temp.ficha(), 'qr-viaje'), 'P0001',
  'saldo_insuficiente: la recompensa vale 1000 puntos y el saldo disponible es 300', 'se mantiene la regla de saldo');
select throws_ok(format('select public.canjear_qr(%L, %L)', pg_temp.ficha(), 'qr-otro'), 'P0001',
  'recompensa_inexistente: la recompensa no existe, no está activa o no corresponde a este proveedor', 'no canjea recompensas de otro proveedor');
select is(pg_temp.saldo('ad000000-0000-0000-0000-000000000001'), 300, 'los intentos rechazados no descuentan nada');

select ok((select (r ->> 'ok')::boolean and (r ->> 'puntos')::integer = 50 and (r ->> 'puntos_disponibles')::integer = 250 and not (r ->> 'duplicado')::boolean
           from public.canjear_qr(pg_temp.ficha(), 'qr-cafe') r),
  'el operador canjea: −50, saldo 250');
select row_eq($$select origen, proveedor, registrado_por, referencia_externa like 'qr:%' from public.canjes
                 where aliado_id = 'ad000000-0000-0000-0000-000000000001'$$,
  row('qr'::text, 'geenera'::text, 'ad000000-0000-0000-0000-0000000000a1'::uuid, true),
  'el canje guarda origen qr, el proveedor del operador y quién lo registró');
select is((select creado_por from public.movimientos_puntos where aliado_id = 'ad000000-0000-0000-0000-000000000001' and tipo = 'redimido'),
  'canjes_qr', 'el movimiento redimido queda marcado como canje por QR');
select ok((select (r ->> 'duplicado')::boolean and (r ->> 'puntos_disponibles')::integer = 250 from public.canjear_qr(pg_temp.ficha(), 'qr-cafe') r),
  'confirmar dos veces devuelve el mismo canje (doble toque)');
select is(public.canjear_qr(pg_temp.ficha(), 'qr-viaje') ->> 'codigo', 'qr_usado', 'un QR usado no sirve para otra recompensa');
select is(pg_temp.saldo('ad000000-0000-0000-0000-000000000001'), 250, 'solo se descontó una vez');
select is(public.consultar_qr_canje(pg_temp.codigo()) ->> 'codigo', 'qr_usado', 'el código corto de un QR usado tampoco sirve');
select is((select count(*)::integer from public.mis_canjes_registrados()), 1, 'el operador ve sus canjes del día');
select pg_temp.como('ad000000-0000-0000-0000-0000000000a2');
select is(public.canjear_qr(pg_temp.ficha(), 'qr-cafe') ->> 'codigo', 'qr_usado', 'otro operador tampoco puede reutilizarlo');

select pg_temp.como('ad000000-0000-0000-0000-000000000001');
select ok((select r ->> 'estado' = 'usado' and r ->> 'recompensa' = 'Bono de café' and (r ->> 'puntos_disponibles')::integer = 250
           from public.estado_qr_canje(pg_temp.codigo()) r),
  'el Hub del aliado ve el canje con su nuevo saldo');
select ok((select origen = 'qr' from public.v_mis_canjes), 'el aliado ve el canje como QR en su historial');

-- Vencimiento, QR propio y límites --------------------------------------------------------------------------------------------

select pg_temp.nuevo_qr();
update public.canjes_qr set vence_at = now() - interval '1 second' where aliado_id = 'ad000000-0000-0000-0000-000000000001' and usado_at is null and anulado_at is null;
select is(public.estado_qr_canje(pg_temp.codigo()) ->> 'estado', 'vencido', 'el Hub ve el QR vencido');
select pg_temp.como('ad000000-0000-0000-0000-0000000000a1');
select is(public.canjear_qr(pg_temp.ficha(), 'qr-cafe') ->> 'codigo', 'qr_vencido', 'un QR de más de 5 minutos no sirve');

select pg_temp.como('ad000000-0000-0000-0000-000000000003');
select pg_temp.nuevo_qr();
select throws_ok(format('select public.canjear_qr(%L, %L)', pg_temp.ficha(), 'qr-cafe'), 'P0001',
  'propio_qr: no puedes registrar un canje con tu propio QR', 'un operador no canjea su propio QR');

select pg_temp.como('ad000000-0000-0000-0000-00000000000a');
select ok((select (r ->> 'ok')::boolean and r ->> 'proveedor' is null from public.canjear_qr(pg_temp.ficha(), 'qr-cafe') r),
  'un admin también registra canjes');
select is((select proveedor from public.canjes where aliado_id = 'ad000000-0000-0000-0000-000000000003'), 'geenera', 'el admin canjea como geenera');
select is((select registrado_por from public.v_admin_canjes where codigo_aliado = pg_temp.cod('ad000000-0000-0000-0000-000000000001')),
  'Oscar Operador', 'el panel muestra quién registró el canje');
select is((select canjes_registrados from public.v_admin_operadores where correo = 'o@qr.test'), 1, 'el panel cuenta los canjes de cada operador');
select pg_temp.como('ad000000-0000-0000-0000-000000000001');
select is((select count(*)::integer from public.v_admin_operadores), 0, 'un aliado no ve la lista de operadores');
select is(public.estado_qr_canje(pg_temp.codigo()) ->> 'estado', 'inexistente', 'un aliado no ve el QR de otro');

select throws_ok($$select public.canjear_qr('x', 'y')$$, 'P0001',
  'no_autorizado: esta cuenta no puede registrar canjes', 'un aliado no canjea');
select pg_temp.como('ad000000-0000-0000-0000-0000000000a1');
select is((select count(*)::integer from generate_series(1, 20) g where public.consultar_qr_canje('ZZZZZZZZ') ->> 'codigo' = 'qr_invalido'), 20,
  'un código inexistente responde qr_invalido');
select throws_ok($$select public.consultar_qr_canje('ZZZZZZZZ')$$, 'P0001',
  'limite_intentos: demasiados códigos inválidos; espera unos minutos', 'tras 20 códigos inválidos en 10 minutos se frena al operador');

select pg_temp.como('ad000000-0000-0000-0000-000000000001');
select lives_ok($$select public.generar_qr_canje() from generate_series(1, 26)$$, 'el aliado puede renovar su QR muchas veces');
select throws_ok($$select public.generar_qr_canje()$$, 'P0001', 'limite_qr: generaste demasiados QR; espera unos minutos',
  'máximo 30 QR cada 10 minutos');

-- Integridad y compatibilidad con la API --------------------------------------------------------------------------------------

select throws_ok($$update public.canjes set origen = 'api' where origen = 'qr'$$, 'P0001', 'canjes no se editan; un admin puede anularlos',
  'el origen de un canje no se edita');
select ok((select (r ->> 'puntos')::integer = 50 and not (r ->> 'duplicado')::boolean
           from public.registrar_canje('prov', pg_temp.cod('ad000000-0000-0000-0000-000000000001'), 'qr-cafe', 'API-1') r),
  'POST /api/canjes sigue igual (misma función y misma respuesta)');
select ok((select origen = 'api' and registrado_por is null from public.canjes where proveedor = 'prov' and referencia_externa = 'API-1'),
  'el canje por API queda con origen api y sin operador');
select is((select count(*)::integer from cron.job where jobname = 'depurar-canjes-qr'), 1, 'la limpieza diaria de fichas está programada');
update public.canjes_qr set vence_at = now() - interval '8 days', creado_at = now() - interval '8 days' where usado_at is null;
select interno.depurar_canjes_qr();
select ok(not exists (select 1 from public.canjes_qr where usado_at is null) and exists (select 1 from public.canjes_qr where usado_at is not null),
  'la limpieza borra las fichas vencidas sin usar y conserva las usadas');

-- Eliminar operadores (fase 11 · 02) -------------------------------------------------------------------------------------

select public.admin_invitar_operador('ad000000-0000-0000-0000-00000000000a', '{"correo":"e@qr.test","nombre":"Error Invitado","proveedor":"geenera"}');
insert into auth.users (id, email, raw_user_meta_data) values ('ad000000-0000-0000-0000-0000000000a4', 'e@qr.test', '{}');
select throws_ok($$select public.admin_eliminar_operador('ad000000-0000-0000-0000-000000000001', (select id from public.operadores where correo = 'e@qr.test'), 'Invitado por error')$$,
  'P0001', 'no_autorizado: se requiere una cuenta de administrador activa', 'un aliado no elimina operadores');
select throws_ok($$select public.admin_eliminar_operador('ad000000-0000-0000-0000-00000000000a', (select id from public.operadores where correo = 'e@qr.test'), '')$$,
  'P0001', 'dato_invalido: el motivo debe tener al menos 5 caracteres', 'eliminar exige motivo');
select is(public.admin_eliminar_operador('ad000000-0000-0000-0000-00000000000a', (select id from public.operadores where correo = 'e@qr.test'), 'Invitado por error') ->> 'borrar_usuario',
  'ad000000-0000-0000-0000-0000000000a4', 'un operador sin canjes se elimina y se indica qué cuenta de acceso borrar');
select ok(not exists (select 1 from public.operadores where correo = 'e@qr.test')
      and exists (select 1 from public.acciones_admin where accion = 'eliminar_operador' and detalle ->> 'correo' = 'e@qr.test'),
  'el operador desaparece y la eliminación queda auditada');
select throws_like($$select public.admin_eliminar_operador('ad000000-0000-0000-0000-00000000000a', (select id from public.operadores where correo = 'o@qr.test'), 'Invitado por error')$$,
  'estado_invalido: o@qr.test ya registró 1 canje(s)%', 'un operador con canjes no se elimina (solo se desactiva)');
select is(public.admin_eliminar_operador('ad000000-0000-0000-0000-00000000000a', (select id from public.operadores where correo = 'c@qr.test'), 'Ya no escanea') ->> 'borrar_usuario',
  null, 'si el operador también es aliado, su cuenta no se borra');
select ok(exists (select 1 from public.aliados where id = 'ad000000-0000-0000-0000-000000000003'), 'y sigue siendo aliado');

select * from finish();
rollback;
