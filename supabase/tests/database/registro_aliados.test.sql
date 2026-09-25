-- Tests del alta de aliados desde Supabase Auth (CLAUDE.md §2, §3, §11).
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- Metadatos válidos por tipo, como los envía el front en signUp({ options: { data } }).
create function pg_temp.meta(tipo text, extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'nombre_completo', 'Juan José Pérez León',
    'celular', '+573001234567',
    'regional', 'Santander',
    'tipo_aliado', tipo,
    'autorizacion_datos', true,
    'acepta_terminos', true
  )
  || case when tipo in ('financiero', 'agremiaciones')
       then jsonb_build_object('organizacion', 'Banco X', 'cargo', 'Gerente')
       else jsonb_build_object('como_llega_empresas', 'Red de contactos') end
  || extra;
$$;

create function pg_temp.registrar(id uuid, email text, meta jsonb)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, meta);
$$;

select has_trigger('auth', 'users', 'on_auth_user_created_aliado', 'existe el trigger de alta en auth.users');

-- Alta válida por cada tipo -----------------------------------------------------------------

select lives_ok($$select pg_temp.registrar('a0000000-0000-0000-0000-000000000001', 'emi@prueba.test', pg_temp.meta('emi'))$$, 'registro emi');
select lives_ok($$select pg_temp.registrar('a0000000-0000-0000-0000-000000000002', 'fin@prueba.test', pg_temp.meta('financiero'))$$, 'registro financiero');
select lives_ok($$select pg_temp.registrar('a0000000-0000-0000-0000-000000000003', 'lk@prueba.test', pg_temp.meta('linker'))$$, 'registro linker');
select lives_ok($$select pg_temp.registrar('a0000000-0000-0000-0000-000000000004', 'ce@prueba.test',
  pg_temp.meta('cliente_embajador', '{"nombre_completo": "María de los Ángeles Núñez"}'))$$, 'registro cliente_embajador');
select lives_ok($$select pg_temp.registrar('a0000000-0000-0000-0000-000000000005', 'ag@prueba.test', pg_temp.meta('agremiaciones'))$$, 'registro agremiaciones');

select matches((select codigo_aliado from public.aliados where id = 'a0000000-0000-0000-0000-000000000001'),
  '^EMJJPL[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'emi → EMJJPL + 8');
select matches((select codigo_aliado from public.aliados where id = 'a0000000-0000-0000-0000-000000000002'),
  '^FIJJPL[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'financiero → FIJJPL + 8');
select matches((select codigo_aliado from public.aliados where id = 'a0000000-0000-0000-0000-000000000003'),
  '^LKJJPL[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'linker → LKJJPL + 8');
select matches((select codigo_aliado from public.aliados where id = 'a0000000-0000-0000-0000-000000000004'),
  '^CEMAN[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'cliente_embajador sin partículas → CEMAN + 8');
select matches((select codigo_aliado from public.aliados where id = 'a0000000-0000-0000-0000-000000000005'),
  '^AGJJPL[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'agremiaciones → AGJJPL + 8');

select results_eq(
  $$select aliado_id::text from public.aliados_perfil_organizacion order by 1$$,
  array['a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005'],
  'financiero y agremiaciones reciben perfil de organización'
);
select results_eq(
  $$select aliado_id::text from public.aliados_perfil_alcance order by 1$$,
  array['a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004'],
  'emi, linker y cliente_embajador reciben perfil de alcance'
);

select row_eq(
  $$select nombre_completo, correo, celular, regional, tipo_aliado::text, estado, rol, terminos_version
    , politica_datos_version
    from public.aliados where id = 'a0000000-0000-0000-0000-000000000001'$$,
  row('Juan José Pérez León'::text, 'emi@prueba.test'::text, '+573001234567'::text, 'Santander'::text, 'emi'::text, 'pendiente'::text, 'aliado'::text, '2026-02-06'::text, '2026-09-25'::text),
  'guarda los datos del registro; el correo sale de Auth; queda pendiente'
);
select ok(
  (select autorizacion_datos_at is not null and terminos_aceptados_at is not null
   from public.aliados where id = 'a0000000-0000-0000-0000-000000000001'),
  'guarda la fecha de autorización de datos y de aceptación de términos'
);
select is(
  (select count(*) from public.aliados where puntos_nivel = 0 and puntos_disponibles = 0 and nivel = 'bronce'
     and clientify_sync_estado = 'pendiente'),
  5::bigint,
  'todo aliado nuevo empieza en bronce, sin puntos y pendiente de sincronizar con Clientify'
);

-- Datos opcionales y normalización ---------------------------------------------------------

select lives_ok($$select pg_temp.registrar('a0000000-0000-0000-0000-000000000006', 'sinregional@prueba.test',
  pg_temp.meta('emi', '{"regional": "   ", "nombre_completo": "  Ana   Ruiz  "}'))$$, 'la regional es opcional');
select is((select regional from public.aliados where id = 'a0000000-0000-0000-0000-000000000006'), null, 'regional vacía → NULL');
select is((select nombre_completo from public.aliados where id = 'a0000000-0000-0000-0000-000000000006'), 'Ana   Ruiz', 'el nombre se guarda recortado');

select lives_ok($$select pg_temp.registrar('a0000000-0000-0000-0000-000000000007', 'mx@prueba.test',
  pg_temp.meta('linker', '{"celular": "+525512345678"}'))$$, 'acepta celulares de otros países en formato internacional');

-- Nadie se da permisos desde el navegador ------------------------------------------------

select lives_ok($$select pg_temp.registrar('a0000000-0000-0000-0000-000000000008', 'listo@prueba.test',
  pg_temp.meta('emi', '{"rol": "admin", "estado": "activo", "puntos_disponibles": 9999, "codigo_aliado": "EMHACK2345678"}'))$$,
  'metadatos extra no rompen el registro');
select row_eq(
  $$select rol, estado, puntos_disponibles, codigo_aliado = 'EMHACK2345678' from public.aliados where id = 'a0000000-0000-0000-0000-000000000008'$$,
  row('aliado'::text, 'pendiente'::text, 0, false),
  'rol, estado, puntos y código nunca se toman de los metadatos'
);

-- Registros inválidos: se rechaza todo el alta ------------------------------------------------

select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000001', 'x1@prueba.test', pg_temp.meta('emi', '{"nombre_completo": "   "}'))$$,
  'P0001', null, 'nombre vacío');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000002', 'x2@prueba.test', pg_temp.meta('emi') - 'celular')$$,
  'P0001', null, 'sin celular');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000003', 'x3@prueba.test', pg_temp.meta('emi', '{"celular": "3001234567"}'))$$,
  'P0001', null, 'celular sin indicativo');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000004', 'x4@prueba.test', pg_temp.meta('emi', '{"celular": "+572001234567"}'))$$,
  'P0001', null, 'celular colombiano que no empieza por 3');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000005', 'x5@prueba.test', pg_temp.meta('emi', '{"celular": "+57300123456"}'))$$,
  'P0001', null, 'celular colombiano con 9 dígitos');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000006', 'x6@prueba.test', pg_temp.meta('embajador'))$$,
  'P0001', null, 'tipo de aliado inexistente');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000007', 'x7@prueba.test', pg_temp.meta('financiero') - 'cargo')$$,
  'P0001', null, 'financiero sin cargo');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000008', 'x8@prueba.test', pg_temp.meta('agremiaciones', '{"organizacion": ""}'))$$,
  'P0001', null, 'agremiaciones sin organización');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000009', 'x9@prueba.test', pg_temp.meta('emi') - 'como_llega_empresas')$$,
  'P0001', null, 'emi sin "cómo llega a las empresas"');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000010', 'x10@prueba.test', pg_temp.meta('linker', '{"autorizacion_datos": false}'))$$,
  'P0001', null, 'sin autorización de tratamiento de datos');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000011', 'x11@prueba.test', pg_temp.meta('linker') - 'acepta_terminos')$$,
  'P0001', null, 'sin aceptar los términos');
select throws_ok($$select pg_temp.registrar('b0000000-0000-0000-0000-000000000012', null, pg_temp.meta('emi'))$$,
  'P0001', null, 'sin correo');
select is(
  (select count(*) from auth.users where id::text like 'b0000000-%'),
  0::bigint,
  'ningún registro inválido dejó un usuario de Auth creado'
);

-- Estado pendiente y RLS ------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}', true);
select results_eq(
  'select estado from public.aliados',
  array['pendiente'],
  'un aliado pendiente puede leer su propia fila (para saber que está en revisión)'
);
select is(interno.es_admin(), false, 'un aliado nuevo nunca es admin');
reset role;

-- Sincronización del correo ---------------------------------------------------------------

update auth.users set email = 'nuevo@prueba.test' where id = 'a0000000-0000-0000-0000-000000000001';
select is(
  (select correo from public.aliados where id = 'a0000000-0000-0000-0000-000000000001'),
  'nuevo@prueba.test',
  'si cambia el correo en Auth, cambia en aliados'
);
select is(
  (select codigo_aliado from public.aliados where id = 'a0000000-0000-0000-0000-000000000001') ~ '^EMJJPL',
  true,
  'cambiar el correo no cambia el código'
);

-- Borrado de la cuenta ----------------------------------------------------------------------

delete from auth.users where id = 'a0000000-0000-0000-0000-000000000002';
select is(
  (select count(*) from public.aliados where id = 'a0000000-0000-0000-0000-000000000002')
  + (select count(*) from public.aliados_perfil_organizacion where aliado_id = 'a0000000-0000-0000-0000-000000000002'),
  0::bigint,
  'borrar el usuario de Auth borra el aliado y su perfil'
);

select * from finish();
rollback;
