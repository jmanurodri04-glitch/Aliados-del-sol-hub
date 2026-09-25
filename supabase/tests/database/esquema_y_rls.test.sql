-- Tests de esquema, integridad y RLS (CLAUDE.md §4, §5.1, §6.1, §10).
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

-- Estructura ----------------------------------------------------------------------

select tables_are('public', array[
  'aliados', 'aliados_perfil_organizacion', 'aliados_perfil_alcance',
  'empresas', 'facturas', 'avance_empresa', 'movimientos_puntos',
  'eventos', 'modulos', 'modulos_completados', 'canjes', 'webhook_eventos', 'reglas_puntos', 'movimientos_retenidos'
], 'existen exactamente las 14 tablas del modelo');

select is(
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity),
  0::bigint,
  'RLS activado en todas las tablas de public'
);

select enum_has_labels('public', 'nivel',
  array['bronce', 'plata', 'oro', 'platino', 'diamante', 'circulo_solar'],
  'el enum nivel va de menor a mayor');

-- Datos de prueba ---------------------------------------------------------------------
-- A: emi · B: financiero · C: linker admin. Se crean como en el registro real: el trigger
-- de auth.users genera el aliado, su codigo_aliado y su perfil. Luego se activan.

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@prueba.test',
   '{"nombre_completo": "Ana Alba", "celular": "+573000000001", "tipo_aliado": "emi",
     "como_llega_empresas": "Red de contactos", "autorizacion_datos": true, "acepta_terminos": true}'),
  ('22222222-2222-2222-2222-222222222222', 'b@prueba.test',
   '{"nombre_completo": "Beto Bravo", "celular": "+573000000002", "tipo_aliado": "financiero",
     "organizacion": "Banco X", "cargo": "Gerente", "autorizacion_datos": true, "acepta_terminos": true}'),
  ('33333333-3333-3333-3333-333333333333', 'c@prueba.test',
   '{"nombre_completo": "Cata Cruz", "celular": "+573000000003", "tipo_aliado": "linker",
     "como_llega_empresas": "Comunidad", "autorizacion_datos": true, "acepta_terminos": true}');

update public.aliados set estado = 'activo';
update public.aliados set rol = 'admin' where id = '33333333-3333-3333-3333-333333333333';

create temp table codigos on commit drop as
  select id, codigo_aliado from public.aliados;

insert into public.empresas (id, aliado_id, origen, empresa, sector, nombre_contacto, telefono, correo, valor_factura, es_perfecto) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'hub', 'Empresa A', 'Industria', 'Contacto A', '3100000001', 'ca@empresa.test', 1000000, false),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'hub', 'Empresa B', 'Comercio',  'Contacto B', '3100000002', 'cb@empresa.test', 2000000, false);

insert into public.avance_empresa (empresa_id) values
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b');

insert into public.movimientos_puntos (aliado_id, tipo, puntos, puntos_aplicados, motivo, vinculo, vinculo_id, clave_unica, creado_por) values
  ('22222222-2222-2222-2222-222222222222', 'ganado', 10, 10, 'registro_valido', 'empresas',
   'bbbbbbbb-0000-0000-0000-00000000000b', 'empresa:bbbbbbbb-0000-0000-0000-00000000000b:registro_valido', 'sistema');

insert into public.modulos (id, nombre, orden, activo) values
  ('dddddddd-0000-0000-0000-000000000001', 'Módulo activo',   1, true),
  ('dddddddd-0000-0000-0000-000000000002', 'Módulo inactivo', 2, false);

insert into public.modulos_completados (aliado_id, modulo_id)
  values ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001');

insert into public.webhook_eventos (payload) values ('{"prueba": true}');

-- Aliados y perfiles ----------------------------------------------------------------------

select is(
  (select como_llega_empresas from public.aliados_perfil_alcance where aliado_id = '11111111-1111-1111-1111-111111111111'),
  'Red de contactos',
  'emi tiene perfil de alcance'
);
select throws_ok(
  $$insert into public.aliados_perfil_organizacion (aliado_id, organizacion, cargo)
    values ('11111111-1111-1111-1111-111111111111', 'Org', 'Cargo')$$,
  'P0001', null, 'emi no puede tener perfil de organización'
);
select throws_ok(
  $$insert into public.aliados_perfil_alcance (aliado_id, como_llega_empresas)
    values ('22222222-2222-2222-2222-222222222222', 'Red')$$,
  'P0001', null, 'financiero no puede tener perfil de alcance'
);
select throws_ok(
  $$update public.aliados set tipo_aliado = 'agremiaciones' where id = '11111111-1111-1111-1111-111111111111'$$,
  'P0001', null, 'no se cambia a un tipo incompatible con el perfil existente'
);
select throws_ok(
  $$update public.aliados set codigo_aliado = 'EMAA99999999' where id = '11111111-1111-1111-1111-111111111111'$$,
  'P0001', 'aliados.codigo_aliado es inmutable', 'codigo_aliado es inmutable'
);
select lives_ok(
  $$update public.aliados set nombre_completo = 'Ana Alba Ruiz' where id = '11111111-1111-1111-1111-111111111111'$$,
  'el resto del aliado sí se puede actualizar'
);
select is(
  (select codigo_aliado from public.aliados where id = '11111111-1111-1111-1111-111111111111'),
  (select codigo_aliado from codigos where id = '11111111-1111-1111-1111-111111111111'),
  'cambiar el nombre no cambia el código'
);
select throws_ok(
  $$insert into public.aliados (id, codigo_aliado, nombre_completo, correo, celular, tipo_aliado, autorizacion_datos_at, terminos_aceptados_at, terminos_version, politica_datos_version)
    values ('33333333-3333-3333-3333-333333333333', 'EMA0OIL1', 'X', 'x@prueba.test', '3', 'emi', now(), now(), 'v', 'v')$$,
  '23514', null, 'rechaza un codigo_aliado con formato inválido'
);
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data) values ('44444444-4444-4444-4444-444444444444', 'A@PRUEBA.TEST',
    '{"nombre_completo": "Dup", "celular": "+573000000004", "tipo_aliado": "emi",
      "como_llega_empresas": "Red", "autorizacion_datos": true, "acepta_terminos": true}')$$,
  '23505', null, 'el correo es único sin distinguir mayúsculas'
);

-- Calidad por empresa (§6.1) --------------------------------------------------------------

select is(
  (select calidad_empresa from public.avance_empresa where empresa_id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  null, 'todo en revisión → calidad NULL'
);
update public.avance_empresa
  set calificado = 'si', perfecto = 'si', oportunidad_tecnica = 'no', integridad_informacion = 'si'
  where empresa_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select is(
  (select calidad_empresa from public.avance_empresa where empresa_id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  80.00, 'si/si/no/si → 40 + 30 + 0 + 10 = 80'
);
update public.avance_empresa
  set calificado = 'no', perfecto = 'no', oportunidad_tecnica = 'no', integridad_informacion = 'no'
  where empresa_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select is(
  (select calidad_empresa from public.avance_empresa where empresa_id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  0.00, 'todo en no → 0'
);
update public.avance_empresa
  set calificado = 'si', perfecto = 'si', oportunidad_tecnica = 'revision', integridad_informacion = 'si'
  where empresa_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select is(
  (select calidad_empresa from public.avance_empresa where empresa_id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  null, 'una sola variable en revisión → NULL (excluida del promedio)'
);

-- Facturas ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.facturas (empresa_id, aliado_id, tipo_documento, storage_path, nombre_archivo)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'pdf', 'x/y/z.pdf', 'z.pdf')$$,
  '23503', null, 'la factura debe ser del mismo aliado que la empresa'
);
select lives_ok(
  $$insert into public.facturas (id, empresa_id, aliado_id, tipo_documento, storage_path, nombre_archivo)
    values ('ffffffff-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a',
            '11111111-1111-1111-1111-111111111111', 'pdf',
            '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-00000000000a/factura.pdf', 'factura.pdf');
    update public.empresas set factura_id = 'ffffffff-0000-0000-0000-00000000000a'
    where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  'se adjunta la factura a su empresa'
);
select throws_ok(
  $$update public.empresas set factura_id = 'ffffffff-0000-0000-0000-00000000000a'
    where id = 'bbbbbbbb-0000-0000-0000-00000000000b'$$,
  '23503', null, 'una empresa no puede apuntar a la factura de otra'
);

-- Libro mayor de puntos (§4.7, §5.1) ---------------------------------------------------------

select lives_ok(
  $$insert into public.movimientos_puntos (aliado_id, tipo, puntos, puntos_aplicados, motivo, vinculo, vinculo_id, clave_unica, creado_por)
    values ('11111111-1111-1111-1111-111111111111', 'ganado', 30, 30, 'empresa_calificada', 'empresas',
            'aaaaaaaa-0000-0000-0000-00000000000a', 'empresa:aaaaaaaa-0000-0000-0000-00000000000a:calificado', 'webhook_clientify')$$,
  'se registra un movimiento ganado'
);
insert into public.movimientos_puntos (aliado_id, tipo, puntos, puntos_aplicados, motivo, vinculo, clave_unica, creado_por)
  values ('11111111-1111-1111-1111-111111111111', 'perdido', 10, 10, 'referido_no_calificado', 'empresas',
          'empresa:aaaaaaaa-0000-0000-0000-00000000000a:calificado', 'webhook_clientify')
  on conflict (clave_unica) do nothing;
select results_eq(
  $$select motivo from public.movimientos_puntos
    where clave_unica = 'empresa:aaaaaaaa-0000-0000-0000-00000000000a:calificado'$$,
  array['empresa_calificada'],
  'idempotencia: la misma clave (calificado) no genera un segundo movimiento, ni +30 y −10 a la vez'
);
select throws_ok(
  $$insert into public.movimientos_puntos (aliado_id, tipo, puntos, puntos_aplicados, motivo, vinculo, clave_unica, creado_por)
    values ('11111111-1111-1111-1111-111111111111', 'ganado', 30, 30, 'empresa_calificada', 'empresas',
            'empresa:aaaaaaaa-0000-0000-0000-00000000000a:calificado', 'sistema')$$,
  '23505', null, 'clave_unica duplicada sin ON CONFLICT falla'
);
select throws_ok(
  $$update public.movimientos_puntos set puntos = 300$$,
  'P0001', null, 'movimientos_puntos no admite UPDATE'
);
select throws_ok(
  $$delete from public.movimientos_puntos$$,
  'P0001', null, 'movimientos_puntos no admite DELETE'
);
select throws_ok(
  $$truncate public.movimientos_puntos$$,
  'P0001', null, 'movimientos_puntos no admite TRUNCATE'
);
select throws_ok(
  $$insert into public.movimientos_puntos (aliado_id, tipo, puntos, puntos_aplicados, motivo, vinculo, clave_unica, creado_por)
    values ('11111111-1111-1111-1111-111111111111', 'ganado', 30, 30, 'informacion_falsa', 'empresas', 't1', 'sistema')$$,
  '23514', null, 'el motivo debe corresponder al tipo'
);
insert into public.movimientos_puntos (aliado_id, tipo, puntos, puntos_aplicados, motivo, vinculo, clave_unica, creado_por)
  values ('11111111-1111-1111-1111-111111111111', 'ganado', 30, 10, 'empresa_calificada', 'empresas', 't2', 'sistema');
select is(
  (select puntos_aplicados from public.movimientos_puntos where clave_unica = 't2'),
  30, 'un ganado siempre se aplica completo (la base ignora el puntos_aplicados recibido)'
);
select lives_ok(
  $$insert into public.movimientos_puntos (aliado_id, tipo, puntos, puntos_aplicados, motivo, vinculo, clave_unica, creado_por)
    values ('11111111-1111-1111-1111-111111111111', 'perdido', 30, 10, 'informacion_falsa', 'empresas', 't3', 'webhook_clientify')$$,
  'un perdido puede aplicarse parcialmente (piso en 0)'
);
select throws_ok(
  $$insert into public.movimientos_puntos (aliado_id, tipo, puntos, puntos_aplicados, motivo, vinculo, clave_unica, creado_por)
    values ('11111111-1111-1111-1111-111111111111', 'perdido', 40, 40, 'informacion_falsa', 'empresas', 't4', 'sistema')$$,
  'P0001', null, 'el valor debe coincidir con la regla del motivo (información falsa vale 30)'
);
select throws_ok(
  $$insert into public.movimientos_puntos (aliado_id, tipo, puntos, puntos_aplicados, motivo, vinculo, clave_unica, creado_por)
    values ('11111111-1111-1111-1111-111111111111', 'ganado', 5, 5, 'ajuste_admin', 'ajuste_admin', 't5', 'admin:juan')$$,
  '23514', null, 'creado_por de admin exige admin:{uuid}'
);

-- Eventos y módulos ------------------------------------------------------------------------

select throws_ok(
  $$insert into public.eventos (aliado_id, nombre_evento, fecha, estado, validado_at, empresas_perfil_count)
    values ('11111111-1111-1111-1111-111111111111', 'Taller', current_date - 1, 'validado', now(), 3)$$,
  '23514', null, 'no se valida un evento sin las condiciones de §4.8'
);
select lives_ok(
  $$insert into public.eventos (aliado_id, nombre_evento, fecha, geenera_involucrada, registro_asistentes,
                               empresas_perfil_count, estado, validado_por, validado_at)
    values ('11111111-1111-1111-1111-111111111111', 'Taller', current_date - 1, true, true, 5, 'validado',
            '33333333-3333-3333-3333-333333333333', now())$$,
  'se valida un evento que cumple las condiciones'
);
select throws_ok(
  $$insert into public.modulos_completados (aliado_id, modulo_id)
    values ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001')$$,
  '23505', null, 'un módulo se completa (y premia) una sola vez'
);

-- RLS: aliado A --------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select results_eq('select id from public.aliados', array['11111111-1111-1111-1111-111111111111'::uuid], 'A solo ve su propia fila de aliados');
select is((select count(*) from public.empresas), 1::bigint, 'A solo ve sus empresas');
select is((select count(*) from public.avance_empresa), 1::bigint, 'A solo ve el avance de sus empresas');
select is(
  (select count(*) from public.movimientos_puntos where aliado_id <> '11111111-1111-1111-1111-111111111111'),
  0::bigint, 'A no ve movimientos de otros'
);
select is((select count(*) from public.aliados_perfil_organizacion), 0::bigint, 'A no ve perfiles de otros');
select is((select count(*) from public.modulos), 1::bigint, 'A solo ve módulos activos');
select is(interno.es_admin(), false, 'A no es admin');
select throws_ok('select * from public.webhook_eventos', '42501', null, 'A no puede leer webhook_eventos');
select throws_ok(
  $$insert into public.empresas (aliado_id, origen, empresa, sector, nombre_contacto, telefono, correo, valor_factura, es_perfecto)
    values ('11111111-1111-1111-1111-111111111111', 'hub', 'X', 'X', 'X', '3', 'x@x.test', 1, false)$$,
  '42501', null, 'A no puede escribir empresas desde el cliente'
);
select throws_ok(
  $$update public.aliados set puntos_disponibles = 99999$$,
  '42501', null, 'A no puede modificar sus puntos'
);

-- RLS: admin C -------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);

select is(interno.es_admin(), true, 'C es admin');
select is((select count(*) from public.aliados), 3::bigint, 'el admin ve todos los aliados');
select is((select count(*) from public.modulos), 2::bigint, 'el admin ve también los módulos inactivos');

-- RLS: anónimo -----------------------------------------------------------------------------

reset role;
set local role anon;
select throws_ok('select * from public.aliados', '42501', null, 'anon no puede leer aliados');
reset role;

-- Borrado de cuenta (Ley 1581) --------------------------------------------------------------

select lives_ok(
  $$delete from auth.users where id = '22222222-2222-2222-2222-222222222222'$$,
  'borrar el usuario de Auth elimina en cascada su información, incluido el libro de puntos'
);
select is(
  (select count(*) from public.movimientos_puntos where aliado_id = '22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.empresas where aliado_id = '22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.aliados where id = '22222222-2222-2222-2222-222222222222'),
  0::bigint,
  'no quedan filas del aliado borrado'
);

select * from finish();
rollback;
