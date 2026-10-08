-- Tests del aviso a n8n de los referidos nuevos del Hub (CLAUDE.md §7.4): perfectos e imperfectos, cada uno con su tipo
-- (su propio webhook); se envían cuando el referido ya está en Clientify; reintentos, panel y permisos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create function pg_temp.aliado(id uuid, email text, celular text)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Aliada N8n', 'celular', celular, 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
$$;
create function pg_temp.empresa(id uuid, aliado uuid, origen text, perfecto boolean, correo text)
returns void language sql as $$
  insert into public.empresas (id, aliado_id, origen, empresa, sector, ciudad, nombre_contacto, telefono, correo, valor_factura, es_perfecto, autorizacion_contacto_at)
  values (id, aliado, origen, 'Empresa ' || left(id::text, 4), 'Industrial', 'Bucaramanga', 'Laura Gómez', '+573105551234', correo, 1000, perfecto, now());
$$;
create function pg_temp.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select pg_temp.aliado('ae000000-0000-0000-0000-00000000000a', 'z@n8n.test', '+573003330001');
select pg_temp.aliado('ae000000-0000-0000-0000-000000000001', 'a@n8n.test', '+573003330002');
update public.aliados set estado = 'activo', rol = 'admin' where id = 'ae000000-0000-0000-0000-00000000000a';
update public.aliados set estado = 'activo' where id = 'ae000000-0000-0000-0000-000000000001';

-- E1 imperfecto del Hub · E2 perfecto del Hub · E3 imperfecto del antiguo formulario de Clientify · E4 imperfecto del Hub
select pg_temp.empresa('ee000000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-000000000001', 'hub', false, 'uno@cliente-n8n.test');
select pg_temp.empresa('ee000000-0000-0000-0000-000000000002', 'ae000000-0000-0000-0000-000000000001', 'hub', true, 'dos@cliente-n8n.test');
select pg_temp.empresa('ee000000-0000-0000-0000-000000000003', 'ae000000-0000-0000-0000-000000000001', 'clientify_form', false, 'tres@cliente-n8n.test');
select pg_temp.empresa('ee000000-0000-0000-0000-000000000004', 'ae000000-0000-0000-0000-000000000001', 'hub', false, 'cuatro@cliente-n8n.test');

select is((select array_agg(empresa_id::text || ':' || tipo order by empresa_id) from public.avisos_n8n where empresa_id::text like 'ee000000%'),
  array['ee000000-0000-0000-0000-000000000001:imperfecto', 'ee000000-0000-0000-0000-000000000002:perfecto',
        'ee000000-0000-0000-0000-000000000004:imperfecto'],
  'los referidos nuevos del Hub entran a la cola con su tipo (no los leads del antiguo formulario)');
select ok(not has_function_privilege('authenticated', 'public.avisos_n8n_reclamar(integer, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.admin_reintentar_aviso_n8n(uuid, uuid)', 'execute')
      and not has_table_privilege('authenticated', 'public.avisos_n8n', 'update')
      and not has_table_privilege('anon', 'public.avisos_n8n', 'select'),
  'el navegador no toca la cola de avisos');

select is((select count(*)::integer from public.avisos_n8n_reclamar(10, 'ee000000-0000-0000-0000-000000000001')), 0,
  'mientras el referido no está en Clientify, el aviso espera');

update public.empresas set clientify_contact_id = 'c-n8n-1' where id = 'ee000000-0000-0000-0000-000000000001';
create temp table lote as select * from public.avisos_n8n_reclamar(10, 'ee000000-0000-0000-0000-000000000001');
select row_eq($$select clientify_contact_id, ciudad, cargo, tiene_factura, nombre_contacto, telefono, correo, codigo_aliado is not null from lote$$,
  row('c-n8n-1'::text, 'Bucaramanga'::text, null::text, false, 'Laura Gómez'::text, '+573105551234'::text, 'uno@cliente-n8n.test'::text, true),
  'con el ID de Clientify se reclama, con los datos que necesita el chatbot');
select is((select tipo from lote), 'imperfecto', 'el reclamo dice a qué webhook va (imperfecto)');
select is((select count(*)::integer from public.avisos_n8n_reclamar(10, 'ee000000-0000-0000-0000-000000000001')), 0,
  'un aviso reclamado queda prestado y no se toma dos veces');
update public.empresas set clientify_contact_id = 'c-n8n-2' where id = 'ee000000-0000-0000-0000-000000000002';
select is((select tipo from public.avisos_n8n_reclamar(10, 'ee000000-0000-0000-0000-000000000002')), 'perfecto',
  'y un perfecto va al webhook de perfectos');

select public.avisos_n8n_resultado('ee000000-0000-0000-0000-000000000001', null);
select row_eq($$select estado, enviado_at is not null from public.avisos_n8n where empresa_id = 'ee000000-0000-0000-0000-000000000001'$$,
  row('enviado'::text, true), 'un envío exitoso queda como enviado');
select public.avisos_n8n_resultado('ee000000-0000-0000-0000-000000000001', 'otro error');
select is((select estado from public.avisos_n8n where empresa_id = 'ee000000-0000-0000-0000-000000000001'), 'enviado',
  'un aviso enviado nunca vuelve a la cola');

update public.empresas set clientify_contact_id = 'c-n8n-4' where id = 'ee000000-0000-0000-0000-000000000004';
select public.avisos_n8n_resultado('ee000000-0000-0000-0000-000000000004', 'n8n respondió 500');
select row_eq($$select estado, intentos, error, proximo_at between now() + interval '14 minutes' and now() + interval '16 minutes'
                from public.avisos_n8n where empresa_id = 'ee000000-0000-0000-0000-000000000004'$$,
  row('error'::text, 1, 'n8n respondió 500'::text, true), 'un fallo guarda el motivo y se reintenta en 15 minutos');
update public.avisos_n8n set intentos = 7 where empresa_id = 'ee000000-0000-0000-0000-000000000004';
select public.avisos_n8n_resultado('ee000000-0000-0000-0000-000000000004', 'n8n respondió 500');
select is((select proximo_at from public.avisos_n8n where empresa_id = 'ee000000-0000-0000-0000-000000000004'), 'infinity'::timestamptz,
  'tras 8 intentos deja de reintentarse solo');

-- Un imperfecto que nunca llegó a Clientify aparece en el panel con su motivo tras 30 minutos.
select pg_temp.empresa('ee000000-0000-0000-0000-000000000005', 'ae000000-0000-0000-0000-000000000001', 'hub', false, 'cinco@cliente-n8n.test');
update public.avisos_n8n set created_at = now() - interval '1 hour' where empresa_id = 'ee000000-0000-0000-0000-000000000005';

set local role authenticated;
select pg_temp.como('ae000000-0000-0000-0000-000000000001');
select is((select count(*)::integer from public.v_admin_avisos_n8n) + (select count(*)::integer from public.avisos_n8n), 0,
  'un aliado no ve los avisos');
select pg_temp.como('ae000000-0000-0000-0000-00000000000a');
select row_eq($$select estado, intentos, error, proximo_at from public.v_admin_avisos_n8n where empresa_id = 'ee000000-0000-0000-0000-000000000004'$$,
  row('error'::text, 8, 'n8n respondió 500'::text, null::timestamptz), 'el panel ve el aviso que no se pudo enviar y su motivo');
select is((select error from public.v_admin_avisos_n8n where empresa_id = 'ee000000-0000-0000-0000-000000000005'),
  'Esperando que el referido llegue a Clientify', 'y el que lleva 30 minutos esperando a Clientify');
select ok((select avisos_n8n_no_enviados >= 2 from public.v_admin_resumen), 'el resumen cuenta los avisos no enviados');
reset role;

select throws_ok($$select public.admin_reintentar_aviso_n8n('ae000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000004')$$,
  'P0001', 'no_autorizado: se requiere una cuenta de administrador activa', 'un aliado no reintenta avisos');
select is(public.admin_reintentar_aviso_n8n('ae000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000004') ->> 'estado', 'pendiente',
  'el admin lo reintenta');
select row_eq($$select estado, intentos, error from public.avisos_n8n where empresa_id = 'ee000000-0000-0000-0000-000000000004'$$,
  row('pendiente'::text, 0, null::text), 'vuelve a la cola de inmediato');
select throws_ok($$select public.admin_reintentar_aviso_n8n('ae000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000001')$$,
  'P0001', 'estado_invalido: este aviso ya se envió', 'un aviso enviado no se reintenta');
select is((select count(*)::integer from public.acciones_admin where accion = 'reintentar_aviso_n8n' and objetivo = 'empresa:ee000000-0000-0000-0000-000000000004'), 1,
  'el reintento queda auditado');

select * from finish();
rollback;
