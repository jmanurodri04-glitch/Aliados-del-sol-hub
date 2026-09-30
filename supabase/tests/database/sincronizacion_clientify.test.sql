-- Tests de la cola de sincronización aliado → Clientify (CLAUDE.md §3, §8 flujo A).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.aliado(id uuid, email text, tipo text)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Prueba Sync', 'celular', '+573001234567', 'tipo_aliado', tipo,
    'organizacion', 'Banco X', 'cargo', 'Gerente', 'como_llega_empresas', 'Red',
    'autorizacion_datos', true, 'acepta_terminos', true));
$$;

select pg_temp.aliado('a1000000-0000-0000-0000-000000000001', 'activo@sync.test', 'financiero');
select pg_temp.aliado('a2000000-0000-0000-0000-000000000002', 'pendiente@sync.test', 'emi');
update public.aliados set estado = 'activo', aprobado_at = now() where id = 'a1000000-0000-0000-0000-000000000001';

-- Reclamo ---------------------------------------------------------------------------------------

create temp table lote as select * from public.clientify_reclamar_aliados(10);
select results_eq('select aliado_id from lote', array['a1000000-0000-0000-0000-000000000001'::uuid],
  'solo se reclaman aliados activos: el pendiente de aprobación no va a Clientify');
select row_eq('select organizacion, cargo, clientify_contact_id, intentos from lote',
  row('Banco X'::text, 'Gerente'::text, null::text, 0),
  'el lote trae organización y cargo, y aún no tiene contacto en Clientify');
select is((select count(*) from public.clientify_reclamar_aliados(10)), 0::bigint,
  'un aliado reclamado queda prestado: otra ejecución no lo toma');

-- Éxito ----------------------------------------------------------------------------------------

select public.clientify_registrar_resultado('a1000000-0000-0000-0000-000000000001', '987654');
select row_eq($$select clientify_sync_estado, clientify_contact_id, clientify_sync_error, clientify_sync_intentos,
                       clientify_sync_proximo_at, clientify_sync_at is not null
                from public.aliados where id = 'a1000000-0000-0000-0000-000000000001'$$,
  row('ok'::text, '987654'::text, null::text, 0, null::timestamptz, true),
  'un éxito guarda el ID del contacto y deja el aliado en ok');
select is((select count(*) from public.clientify_reclamar_aliados(10)), 0::bigint, 'un aliado en ok no se vuelve a reclamar');
select throws_ok($$select public.clientify_registrar_resultado('a1000000-0000-0000-0000-000000000001', null)$$,
  'P0001', null, 'un éxito sin ID de contacto se rechaza');

-- Resincronización al editar el perfil -----------------------------------------------------------

insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, clave_unica, creado_por)
  values ('a1000000-0000-0000-0000-000000000001', 'ganado', 'registro_valido', 'empresas', 'sync:1', 'sistema');
select is((select clientify_sync_estado from public.aliados where id = 'a1000000-0000-0000-0000-000000000001'), 'ok',
  'ganar puntos no dispara una resincronización');

update public.aliados set celular = '+573009999999' where id = 'a1000000-0000-0000-0000-000000000001';
select is((select clientify_sync_estado from public.aliados where id = 'a1000000-0000-0000-0000-000000000001'), 'pendiente',
  'cambiar el celular marca el aliado para resincronizar');

select public.clientify_registrar_resultado('a1000000-0000-0000-0000-000000000001', '987654');
update public.aliados_perfil_organizacion set cargo = 'Director' where aliado_id = 'a1000000-0000-0000-0000-000000000001';
select is((select clientify_sync_estado from public.aliados where id = 'a1000000-0000-0000-0000-000000000001'), 'pendiente',
  'cambiar el cargo también marca el aliado para resincronizar');
select is((select clientify_contact_id from public.aliados where id = 'a1000000-0000-0000-0000-000000000001'), '987654',
  'al resincronizar conserva el ID del contacto (se actualiza, no se duplica)');

-- Errores y reintentos -------------------------------------------------------------------------

select count(*) from public.clientify_reclamar_aliados(10);
select public.clientify_registrar_resultado('a1000000-0000-0000-0000-000000000001', null, 'HTTP 503 de Clientify');
select ok((select clientify_sync_estado = 'error' and clientify_sync_intentos = 1
                  and clientify_sync_proximo_at between now() + interval '14 minutes' and now() + interval '16 minutes'
           from public.aliados where id = 'a1000000-0000-0000-0000-000000000001'),
  'primer error: reintento en 15 minutos');
select is((select count(*) from public.clientify_reclamar_aliados(10)), 0::bigint, 'no se reintenta antes de tiempo');

select public.clientify_registrar_resultado('a1000000-0000-0000-0000-000000000001', null, 'HTTP 503 de Clientify');
select ok((select clientify_sync_intentos = 2
                  and clientify_sync_proximo_at between now() + interval '29 minutes' and now() + interval '31 minutes'
           from public.aliados where id = 'a1000000-0000-0000-0000-000000000001'),
  'segundo error: reintento en 30 minutos (la espera se duplica)');

update public.aliados set clientify_sync_intentos = 20 where id = 'a1000000-0000-0000-0000-000000000001';
select public.clientify_registrar_resultado('a1000000-0000-0000-0000-000000000001', null, repeat('x', 900));
select ok((select clientify_sync_proximo_at <= now() + interval '24 hours' and length(clientify_sync_error) = 500
           from public.aliados where id = 'a1000000-0000-0000-0000-000000000001'),
  'la espera máxima es 24 horas y el error se guarda recortado');

update public.aliados set clientify_sync_proximo_at = now() - interval '1 minute' where id = 'a1000000-0000-0000-0000-000000000001';
select is((select count(*) from public.clientify_reclamar_aliados(10)), 1::bigint, 'cumplida la espera, se reintenta');

-- Permisos --------------------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.clientify_reclamar_aliados(integer)', 'execute')
  and not has_function_privilege('anon', 'public.clientify_registrar_resultado(uuid, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.clientify_reclamar_aliados(integer)', 'execute'),
  'solo el servidor puede reclamar y registrar sincronizaciones'
);

select * from finish();
rollback;
