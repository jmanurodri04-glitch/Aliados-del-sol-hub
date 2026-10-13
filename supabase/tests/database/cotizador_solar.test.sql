-- Tests del Cotizador Solar: tablas por tipo de proyecto, cola de Clientify, borrado desde el panel y permisos
-- (CLAUDE.md §7.5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.fila(extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'telefono', '+573001234567', 'correo', 'ana+prueba@empresa.test', 'ciudad', 'Barranquilla', 'departamento', 'Atlántico',
    'region', 'Costa', 'unidad', 'cop', 'consumo_kwh_mes', 14492.8, 'valor_factura_cop', 10000000, 'conectado_red', true,
    'almacenamiento', 'none', 'potencia_kwp', 110.7, 'modulos', 180, 'inversores', 2, 'generacion_kwh_mes', 11657,
    'cobertura_pct', 80, 'ahorro_anual_cop', 96517559, 'payback_anios', 3.9, 'co2_t_anio', 22.94, 'almacenamiento_kwh', 0,
    'area_minima_m2', 649, 'inversion_total_cop', 377266000) || extra;
$$;
create function pg_temp.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- Z: admin
insert into auth.users (id, email, raw_user_meta_data) values ('c0000000-0000-0000-0000-00000000000a', 'z@cotizador.test',
  jsonb_build_object('nombre_completo', 'Admin Cotizador', 'celular', '+573002230001', 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
update public.aliados set estado = 'activo', rol = 'admin' where id = 'c0000000-0000-0000-0000-00000000000a';

-- Límite por conexión
select ok(public.cotizador_intento(repeat('c', 64), 2) and public.cotizador_intento(repeat('c', 64), 2), 'dos intentos dentro del límite');
select ok(not public.cotizador_intento(repeat('c', 64), 2), 'el tercero supera el límite de la hora');

-- Simulaciones
create temp table ids (seg text, id uuid);
insert into ids select 'industrial', public.cotizador_registrar_simulacion('industrial',
  pg_temp.fila('{"empresa": "Plásticos del Caribe", "contacto": "Ana Pérez", "subsector": "Plásticos",
                 "id": "c0000000-0000-0000-0000-0000000000ff", "clientify_sync_estado": "ok", "politica_datos_version": "x"}'));
insert into ids select 'residencial', public.cotizador_registrar_simulacion('residencial',
  pg_temp.fila('{"nombre": "Juan Gómez", "conectado_red": false, "almacenamiento": "autonomia", "ahorro_anual_cop": null, "payback_anios": null}'));

select is((select count(*)::int from public.cotizador_industrial), 1, 'la simulación industrial va a su tabla');
select is((select count(*)::int from public.cotizador_comercial), 0, 'la tabla comercial no recibe filas de otro tipo');
select isnt((select id from public.cotizador_industrial), 'c0000000-0000-0000-0000-0000000000ff'::uuid, 'el id lo pone la base, no el servidor');
select is((select clientify_sync_estado from public.cotizador_industrial), null, 'una simulación sin propuesta no entra a la cola');
select is((select politica_datos_version from public.cotizador_industrial), interno.version_politica_datos_vigente(), 'guarda la versión vigente de la política');
select ok((select ahorro_anual_cop is null and payback_anios is null and not conectado_red from public.cotizador_residencial), 'un sistema aislado no guarda ahorro ni retorno');
select throws_like($$select public.cotizador_registrar_simulacion('residencial', pg_temp.fila('{"nombre": "Juan", "telefono": "+572001234567"}'))$$,
  '%cotizador_residencial_telefono_check%', 'un celular de Colombia que no empieza por 3 se rechaza');
select throws_ok($$select public.cotizador_registrar_simulacion('otro', pg_temp.fila())$$,
  'P0001', 'dato_invalido: tipo de proyecto inválido', 'solo hay tres tipos de proyecto');

-- Propuesta y cola de Clientify
select is(public.cotizador_solicitar_propuesta('industrial', (select id from ids where seg = 'industrial')) ->> 'estado', 'pendiente', 'pedir la propuesta la pone en la cola');
select is(public.cotizador_solicitar_propuesta('industrial', (select id from ids where seg = 'industrial')) ->> 'estado', 'pendiente', 'pedirla otra vez no la duplica');
select throws_ok(format($$select public.cotizador_solicitar_propuesta('residencial', %L)$$, (select id from ids where seg = 'industrial')),
  'P0001', 'simulacion_inexistente: la simulación no existe o ya venció', 'el id debe ser del mismo tipo');
select is((select count(*)::int from public.cotizador_reclamar_propuestas(10)), 1, 'la cola entrega la propuesta pendiente');
select is((select count(*)::int from public.cotizador_reclamar_propuestas(10)), 0, 'prestada por 10 minutos: no se entrega dos veces');
select public.cotizador_resultado_propuesta('industrial', (select id from ids where seg = 'industrial'), null, 'Clientify 500');
select ok((select clientify_sync_estado = 'error' and clientify_sync_intentos = 1 and clientify_sync_proximo_at > now() + interval '14 minutes'
  from public.cotizador_industrial), 'un error programa el reintento a los 15 minutos');
update public.cotizador_industrial set clientify_sync_proximo_at = now();
select public.cotizador_resultado_propuesta('industrial', (select id from ids where seg = 'industrial'), '987', null);
select ok((select clientify_sync_estado = 'ok' and clientify_contact_id = '987' from public.cotizador_industrial), 'el éxito guarda el contacto de Clientify');

-- Borrado desde el panel: no borra propuestas que aún no llegan a Clientify
select public.cotizador_solicitar_propuesta('residencial', (select id from ids where seg = 'residencial'));
select is(public.admin_cotizador_borrar('c0000000-0000-0000-0000-00000000000a', 'residencial', now() - interval '1 day', now() + interval '1 minute'),
  '{"borradas": 0, "sin_enviar": 1}'::jsonb, 'una propuesta sin enviar no se borra');
select is(public.admin_cotizador_borrar('c0000000-0000-0000-0000-00000000000a', 'industrial', now() - interval '1 day', now() + interval '1 minute'),
  '{"borradas": 1, "sin_enviar": 0}'::jsonb, 'borra lo descargado del rango');
select is((select count(*)::int from public.acciones_admin where accion = 'borrar_cotizaciones'), 2, 'cada borrado queda en la auditoría');

-- Permisos
set local role anon;
select throws_ok($$select count(*) from public.cotizador_residencial$$, '42501', null, 'sin sesión no se leen las simulaciones');
reset role;
set local role authenticated;
select pg_temp.como('c0000000-0000-0000-0000-00000000000a');
select is((select simulaciones::int from public.v_admin_cotizador where segmento = 'residencial'), 1, 'un admin ve el resumen del panel');
reset role;

select * from finish();
rollback;
