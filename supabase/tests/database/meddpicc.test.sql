-- Tests del MEDDPICC (+20 una vez por referido, otorgado por un admin) y de la cola del correo «Confirmación de empresa
-- referida» (CLAUDE.md §5, §7).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

create function pg_temp.aliado(id uuid, email text, celular text)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Aliada Meddpicc', 'celular', celular, 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
$$;
create function pg_temp.datos(correo text, extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'empresa', 'Industrias Sol', 'sector', 'Industrial', 'subsector', 'Manufactura', 'ciudad', 'Bucaramanga',
    'nombre_contacto', 'Laura Gómez', 'cargo', 'Gerente', 'telefono', '+573105551234', 'correo', correo,
    'valor_factura', 4500000, 'autorizacion_contacto', true) || extra;
$$;
create function pg_temp.saldo(id uuid) returns integer language sql as $$ select puntos_disponibles from public.aliados where aliados.id = saldo.id; $$;
create function pg_temp.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- Z: admin · A: aliado activo · P: aliado pendiente
select pg_temp.aliado('ad000000-0000-0000-0000-00000000000a', 'z@meddpicc.test', '+573002220001');
select pg_temp.aliado('ad000000-0000-0000-0000-000000000001', 'a@meddpicc.test', '+573002220002');
select pg_temp.aliado('ad000000-0000-0000-0000-000000000002', 'p@meddpicc.test', '+573002220003');
update public.aliados set estado = 'activo', rol = 'admin' where id = 'ad000000-0000-0000-0000-00000000000a';
update public.aliados set estado = 'activo' where id = 'ad000000-0000-0000-0000-000000000001';

-- Referidos: E1 imperfecto con ciudad, E2 imperfecto sin ciudad, E3 de la cuenta pendiente.
select public.registrar_oportunidad('ad000000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-000000000001',
  pg_temp.datos('uno@cliente-meddpicc.test'), null);
select public.registrar_oportunidad('ad000000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-000000000002',
  pg_temp.datos('dos@cliente-meddpicc.test', '{"ciudad": "", "empresa": "Sin Ciudad SAS"}'), null);
select public.registrar_oportunidad_publica('p@meddpicc.test', 'ed000000-0000-0000-0000-000000000003',
  pg_temp.datos('tres@cliente-meddpicc.test', '{"empresa": "Retenida SAS"}'), null);

-- Regla y permisos ---------------------------------------------------------------------------------------------------

select row_eq($$select tipo, puntos, descripcion from public.reglas_puntos where motivo = 'meddpicc'$$,
  row('ganado'::text, 20, 'Información MEDDPICC'::text), 'la regla meddpicc vale +20');
select ok(not has_function_privilege('authenticated', 'public.admin_otorgar_meddpicc(uuid, uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.correos_referido_reclamar(integer, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.correos_referido_resultado(uuid, text)', 'execute')
      and not has_table_privilege('authenticated', 'public.correos_referido', 'update')
      and not has_table_privilege('anon', 'public.correos_referido', 'select'),
  'el navegador no toca la cola de correos ni otorga el MEDDPICC');

-- Cola del correo ----------------------------------------------------------------------------------------------------

select is((select count(*)::integer from public.correos_referido where empresa_id in
  ('ed000000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-000000000002', 'ed000000-0000-0000-0000-000000000003')
  and estado = 'pendiente'), 3, 'cada referido nuevo del Hub (sesión y formulario público) queda en la cola del correo');

create temp table lote as select * from public.correos_referido_reclamar(10, null)
  where empresa_id in ('ed000000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-000000000002', 'ed000000-0000-0000-0000-000000000003');
select is((select count(*)::integer from lote), 3, 'el cron reclama los correos pendientes');
select row_eq($$select empresa, ciudad, es_perfecto, aplica_meddpicc, correo_aliado, estado_aliado from lote
                where empresa_id = 'ed000000-0000-0000-0000-000000000001'$$,
  row('Industrias Sol'::text, 'Bucaramanga'::text, false, true, 'a@meddpicc.test'::text, 'activo'::text),
  'trae lo necesario para el correo: imperfecto con ciudad aplica al MEDDPICC');
select is((select aplica_meddpicc from lote where empresa_id = 'ed000000-0000-0000-0000-000000000002'), false,
  'imperfecto sin ciudad: solo confirmación, sin MEDDPICC');
select is((select estado_aliado from lote where empresa_id = 'ed000000-0000-0000-0000-000000000003'), 'pendiente',
  'el correo sabe si la cuenta está pendiente (para avisar que los puntos quedan en espera)');
select is((select count(*)::integer from public.correos_referido_reclamar(10, 'ed000000-0000-0000-0000-000000000001')), 0,
  'un correo reclamado queda prestado y no se toma dos veces');

select public.correos_referido_resultado('ed000000-0000-0000-0000-000000000001', null);
select row_eq($$select estado, error, enviado_at is not null from public.correos_referido where empresa_id = 'ed000000-0000-0000-0000-000000000001'$$,
  row('enviado'::text, null::text, true), 'un envío exitoso queda como enviado');
select public.correos_referido_resultado('ed000000-0000-0000-0000-000000000001', 'otro error');
select is((select estado from public.correos_referido where empresa_id = 'ed000000-0000-0000-0000-000000000001'), 'enviado',
  'un correo enviado nunca vuelve a la cola');

select public.correos_referido_resultado('ed000000-0000-0000-0000-000000000002', 'Resend: se alcanzó el límite de envíos');
select row_eq($$select estado, intentos, error, proximo_at between now() + interval '14 minutes' and now() + interval '16 minutes'
                from public.correos_referido where empresa_id = 'ed000000-0000-0000-0000-000000000002'$$,
  row('error'::text, 1, 'Resend: se alcanzó el límite de envíos'::text, true), 'un fallo guarda el motivo y se reintenta en 15 minutos');
update public.correos_referido set intentos = 7 where empresa_id = 'ed000000-0000-0000-0000-000000000002';
select public.correos_referido_resultado('ed000000-0000-0000-0000-000000000002', 'Resend: se alcanzó el límite de envíos');
select is((select proximo_at from public.correos_referido where empresa_id = 'ed000000-0000-0000-0000-000000000002'), 'infinity'::timestamptz,
  'tras 8 intentos deja de reintentarse solo');

-- Panel: correos no enviados -------------------------------------------------------------------------------------------

set local role authenticated;
select pg_temp.como('ad000000-0000-0000-0000-000000000001');
select is((select count(*)::integer from public.v_admin_correos) + (select count(*)::integer from public.v_admin_referidos)
  + (select count(*)::integer from public.correos_referido), 0,
  'un aliado no ve las vistas del panel');
select pg_temp.como('ad000000-0000-0000-0000-00000000000a');
select row_eq($$select empresa, estado, intentos, error, proximo_at from public.v_admin_correos where empresa_id = 'ed000000-0000-0000-0000-000000000002'$$,
  row('Sin Ciudad SAS'::text, 'error'::text, 8, 'Resend: se alcanzó el límite de envíos'::text, null::timestamptz),
  'el panel ve el correo que no se pudo enviar y su motivo');
select ok((select correos_no_enviados >= 1 from public.v_admin_resumen), 'el resumen cuenta los correos no enviados');
reset role;

select is(public.admin_reintentar_correo('ad000000-0000-0000-0000-00000000000a', 'ed000000-0000-0000-0000-000000000002') ->> 'estado', 'pendiente',
  'el admin lo reintenta');
select row_eq($$select estado, intentos, error, proximo_at <= now() from public.correos_referido where empresa_id = 'ed000000-0000-0000-0000-000000000002'$$,
  row('pendiente'::text, 0, null::text, true), 'vuelve a la cola de inmediato');
select throws_ok($$select public.admin_reintentar_correo('ad000000-0000-0000-0000-00000000000a', 'ed000000-0000-0000-0000-000000000001')$$,
  'P0001', 'estado_invalido: este correo ya se envió', 'un correo enviado no se reintenta');

-- MEDDPICC -------------------------------------------------------------------------------------------------------------

select throws_ok($$select public.admin_otorgar_meddpicc('ad000000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-000000000001')$$,
  'P0001', 'no_autorizado: se requiere una cuenta de administrador activa', 'un aliado no otorga el MEDDPICC');
select throws_ok($$select public.admin_otorgar_meddpicc('ad000000-0000-0000-0000-00000000000a', 'ed000000-0000-0000-0000-000000000002')$$,
  'P0001', 'no_permitido: el MEDDPICC solo aplica a referidos perfectos o imperfectos con ciudad', 'imperfecto sin ciudad no aplica');

create temp table s0 as select pg_temp.saldo('ad000000-0000-0000-0000-000000000001') as s;
select is(public.admin_otorgar_meddpicc('ad000000-0000-0000-0000-00000000000a', 'ed000000-0000-0000-0000-000000000001', 'Recibido por correo') ->> 'puntos',
  '20', 'el admin otorga +20 por el MEDDPICC');
select is(pg_temp.saldo('ad000000-0000-0000-0000-000000000001') - (select s from s0), 20, 'el saldo sube 20');
select throws_ok($$select public.admin_otorgar_meddpicc('ad000000-0000-0000-0000-00000000000a', 'ed000000-0000-0000-0000-000000000001')$$,
  'P0001', 'estado_invalido: ya se otorgó el MEDDPICC de este referido', 'solo una vez por referido');

select is(public.admin_otorgar_meddpicc('ad000000-0000-0000-0000-00000000000a', 'ed000000-0000-0000-0000-000000000003') ->> 'retenido',
  'true', 'si la cuenta está pendiente, el +20 queda retenido');
select throws_ok($$select public.admin_otorgar_meddpicc('ad000000-0000-0000-0000-00000000000a', 'ed000000-0000-0000-0000-000000000003')$$,
  'P0001', 'estado_invalido: ya se otorgó el MEDDPICC de este referido', 'retenido también cuenta como otorgado');

set local role authenticated;
select pg_temp.como('ad000000-0000-0000-0000-00000000000a');
select is((select array_agg(meddpicc_otorgado order by empresa_id) from public.v_admin_referidos where empresa_id in
  ('ed000000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-000000000002', 'ed000000-0000-0000-0000-000000000003')),
  array[true, false, true], 'el panel ve en cada referido si ya se otorgó el MEDDPICC');
reset role;

select * from finish();
rollback;
