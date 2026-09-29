-- Tests del panel de administración y de los eventos (CLAUDE.md §3, §4.8, §5, §5.1, §10).
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

create function pg_temp.aliado(id uuid, email text, tipo text default 'emi')
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Prueba Admin ' || tipo, 'celular', '+573001234567', 'tipo_aliado', tipo,
    'organizacion', 'Org', 'cargo', 'Cargo', 'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
$$;
create function pg_temp.cod(id uuid) returns text language sql as $$ select codigo_aliado from public.aliados where aliados.id = cod.id; $$;
create function pg_temp.estado(id uuid) returns text language sql as $$ select estado from public.aliados where aliados.id = estado.id; $$;
create function pg_temp.saldo(id uuid) returns integer language sql as $$ select puntos_disponibles from public.aliados where aliados.id = saldo.id; $$;
create function pg_temp.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- Z: admin · A: solicitud pendiente · B: aliado activo · C: otra solicitud · Y: otro admin
select pg_temp.aliado('a9000000-0000-0000-0000-00000000000a', 'z@admin.test');
select pg_temp.aliado('a9000000-0000-0000-0000-000000000001', 'a@admin.test');
select pg_temp.aliado('a9000000-0000-0000-0000-000000000002', 'b@admin.test');
select pg_temp.aliado('a9000000-0000-0000-0000-000000000003', 'c@admin.test');
select pg_temp.aliado('a9000000-0000-0000-0000-00000000000b', 'y@admin.test');
update public.aliados set estado = 'activo', rol = 'admin' where id in ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b');
update public.aliados set estado = 'activo' where id = 'a9000000-0000-0000-0000-000000000002';

-- Permisos ------------------------------------------------------------------------------------------------------

select throws_ok($$select public.admin_aprobar_aliado('a9000000-0000-0000-0000-000000000002', (select codigo_aliado from public.aliados where id = 'a9000000-0000-0000-0000-000000000001'))$$,
  'P0001', 'no_autorizado: se requiere una cuenta de administrador activa', 'un aliado que no es admin no puede aprobar');
select ok(not has_function_privilege('authenticated', 'public.admin_aprobar_aliado(uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.admin_ajuste_puntos(uuid, text, integer, text, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.admin_validar_evento(uuid, uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.registrar_evento(uuid, uuid, jsonb, text)', 'execute'),
  'el navegador no puede ejecutar las funciones de admin ni registrar eventos directamente');
select throws_ok($$select public.admin_aprobar_aliado('a9000000-0000-0000-0000-00000000000a', 'NOEXISTE123')$$,
  'P0001', 'aliado_inexistente: no existe un aliado con ese código', 'un código inexistente se rechaza');

-- Solicitudes ---------------------------------------------------------------------------------------------------

select is(public.admin_aprobar_aliado('a9000000-0000-0000-0000-00000000000a', lower(pg_temp.cod('a9000000-0000-0000-0000-000000000001'))) ->> 'estado',
  'activo', 'el admin aprueba una solicitud (el código no distingue mayúsculas)');
select row_eq($$select estado, aprobado_por from public.aliados where id = 'a9000000-0000-0000-0000-000000000001'$$,
  row('activo'::text, 'a9000000-0000-0000-0000-00000000000a'::uuid), 'queda activa con aprobado_por');
select ok((select aprobado_at is not null from public.aliados where id = 'a9000000-0000-0000-0000-000000000001'), 'y con aprobado_at');
select throws_ok($$select public.admin_aprobar_aliado('a9000000-0000-0000-0000-00000000000a', (select codigo_aliado from public.aliados where id = 'a9000000-0000-0000-0000-000000000001'))$$,
  'P0001', null, 'no se aprueba dos veces');

select throws_ok($$select public.admin_rechazar_aliado('a9000000-0000-0000-0000-00000000000a', (select codigo_aliado from public.aliados where id = 'a9000000-0000-0000-0000-000000000003'), 'no')$$,
  'P0001', 'dato_invalido: el motivo debe tener al menos 5 caracteres', 'rechazar exige un motivo');
select is(public.admin_rechazar_aliado('a9000000-0000-0000-0000-00000000000a', pg_temp.cod('a9000000-0000-0000-0000-000000000003'), 'Perfil fuera del programa') ->> 'estado',
  'rechazado', 'el admin rechaza una solicitud pendiente');
select is(public.admin_aprobar_aliado('a9000000-0000-0000-0000-00000000000a', pg_temp.cod('a9000000-0000-0000-0000-000000000003')) ->> 'estado',
  'activo', 'una solicitud rechazada se puede reconsiderar y aprobar');

-- Suspensión ----------------------------------------------------------------------------------------------------

select is(public.admin_suspender_aliado('a9000000-0000-0000-0000-00000000000a', pg_temp.cod('a9000000-0000-0000-0000-000000000002'), 'Referidos falsos repetidos') ->> 'estado',
  'suspendido', 'el admin suspende una cuenta activa');
select throws_ok($$select public.admin_suspender_aliado('a9000000-0000-0000-0000-00000000000a', (select codigo_aliado from public.aliados where id = 'a9000000-0000-0000-0000-00000000000b'), 'Prueba de suspensión')$$,
  'P0001', 'no_permitido: una cuenta de administrador no se suspende desde el panel', 'no se suspende a otro admin');
select throws_ok($$select public.admin_suspender_aliado('a9000000-0000-0000-0000-00000000000a', (select codigo_aliado from public.aliados where id = 'a9000000-0000-0000-0000-00000000000a'), 'Prueba de suspensión')$$,
  'P0001', 'no_permitido: una cuenta de administrador no se suspende desde el panel', 'ni a sí mismo');

-- Suspendido: la baja calidad queda retenida; el ajuste de admin se aplica igual (§4.7).
select is(public.admin_baja_calidad('a9000000-0000-0000-0000-00000000000a', pg_temp.cod('a9000000-0000-0000-0000-000000000002'), 'Retroalimentación del 1 de septiembre') ->> 'retenido',
  'true', 'la baja calidad de una cuenta suspendida queda retenida');
select is(public.admin_ajuste_puntos('a9000000-0000-0000-0000-00000000000a', pg_temp.cod('a9000000-0000-0000-0000-000000000002'), 40, 'Evento anterior al programa', 'b9000000-0000-0000-0000-000000000001') ->> 'puntos_aplicados',
  '40', 'un ajuste positivo se aplica aunque la cuenta esté suspendida');
select is(public.admin_reactivar_aliado('a9000000-0000-0000-0000-00000000000a', pg_temp.cod('a9000000-0000-0000-0000-000000000002'), 'Aclaró los referidos') ->> 'estado',
  'activo', 'el admin reactiva una cuenta suspendida');
select is(pg_temp.saldo('a9000000-0000-0000-0000-000000000002'), 20, 'al reactivar se acredita la baja calidad retenida: 40 − 20');

-- Ajustes y baja calidad --------------------------------------------------------------------------------------------

select is(public.admin_ajuste_puntos('a9000000-0000-0000-0000-00000000000a', pg_temp.cod('a9000000-0000-0000-0000-000000000002'), 40, 'Evento anterior al programa', 'b9000000-0000-0000-0000-000000000001') ->> 'duplicado',
  'true', 'la misma clave no duplica el ajuste (doble clic)');
select is(public.admin_ajuste_puntos('a9000000-0000-0000-0000-00000000000a', pg_temp.cod('a9000000-0000-0000-0000-000000000002'), -50, 'Corrección de puntos de prueba', 'b9000000-0000-0000-0000-000000000002') ->> 'puntos_aplicados',
  '20', 'un ajuste negativo respeta el piso en 0: −50 con saldo 20 descuenta 20');
select is(pg_temp.saldo('a9000000-0000-0000-0000-000000000002'), 0, 'el saldo queda en 0');
select throws_ok($$select public.admin_ajuste_puntos('a9000000-0000-0000-0000-00000000000a', (select codigo_aliado from public.aliados where id = 'a9000000-0000-0000-0000-000000000002'), 10, 'corto', gen_random_uuid())$$,
  'P0001', 'dato_invalido: la justificación debe tener al menos 10 caracteres', 'el ajuste exige una justificación');
select throws_ok($$select public.admin_ajuste_puntos('a9000000-0000-0000-0000-00000000000a', (select codigo_aliado from public.aliados where id = 'a9000000-0000-0000-0000-000000000002'), 0, 'Ajuste sin puntos de prueba', gen_random_uuid())$$,
  'P0001', 'dato_invalido: el ajuste debe ser distinto de 0 y de máximo 5000 puntos', 'un ajuste de 0 se rechaza');
select is((select creado_por from public.movimientos_puntos where clave_unica = 'ajuste:b9000000-0000-0000-0000-000000000001'),
  'admin:a9000000-0000-0000-0000-00000000000a', 'el movimiento queda auditado con creado_por admin:{id}');

select public.admin_ajuste_puntos('a9000000-0000-0000-0000-00000000000a', pg_temp.cod('a9000000-0000-0000-0000-000000000001'), 100, 'Saldo inicial de prueba', 'b9000000-0000-0000-0000-000000000003');
select public.admin_baja_calidad('a9000000-0000-0000-0000-00000000000a', pg_temp.cod('a9000000-0000-0000-0000-000000000001'), 'Retroalimentación del 1 de septiembre');
select is(pg_temp.saldo('a9000000-0000-0000-0000-000000000001'), 80, 'la baja calidad reiterada resta 20');
select throws_ok($$select public.admin_baja_calidad('a9000000-0000-0000-0000-00000000000a', (select codigo_aliado from public.aliados where id = 'a9000000-0000-0000-0000-000000000001'), 'Retroalimentación del 1 de septiembre')$$,
  'P0001', 'estado_invalido: ya se registró una baja calidad reiterada para este aliado hoy', 'una sola baja calidad por aliado y día');

-- Eventos ---------------------------------------------------------------------------------------------------------

select throws_ok($$select public.registrar_evento('a9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000000',
    '{"nombre_evento": "Taller solar", "fecha": "2999-01-01", "geenera_involucrada": true, "registro_asistentes": true, "empresas_perfil_count": 6}')$$,
  'P0001', 'evento_invalido: la fecha debe ser la de un evento ya realizado en el último año', 'no se reporta un evento futuro');
select throws_ok($$select public.registrar_evento('a9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000000',
    '{"nombre_evento": "Taller solar", "fecha": "2026-09-01"}', 'otro-aliado/archivo.pdf')$$,
  'P0001', 'archivo_invalido: el registro de asistentes no corresponde a este evento', 'el archivo debe estar en la carpeta del aliado y del evento');
select is(public.registrar_evento('a9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001',
    jsonb_build_object('nombre_evento', 'Taller solar Cámara', 'tipo_evento', 'Taller', 'fecha', current_date - 3,
      'geenera_involucrada', true, 'registro_asistentes', true, 'empresas_perfil_count', 6)) ->> 'estado',
  'pendiente', 'el aliado reporta un evento completo');
select is(public.registrar_evento('a9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000002',
    jsonb_build_object('nombre_evento', 'Desayuno empresarial', 'fecha', current_date - 5,
      'geenera_involucrada', true, 'registro_asistentes', false, 'empresas_perfil_count', 8)) ->> 'estado',
  'pendiente', 'y otro sin registro de asistentes');
select throws_ok($$select public.registrar_evento('a9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001',
    jsonb_build_object('nombre_evento', 'Taller solar Cámara', 'fecha', current_date - 3))$$,
  'P0001', 'evento_duplicado: este evento ya fue reportado', 'el mismo evento no se reporta dos veces');

select throws_ok($$select public.admin_validar_evento('a9000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-000000000002')$$,
  'P0001', 'evento_incompleto: no hay registro de asistentes', 'un evento sin las 4 condiciones no se valida');
select is(public.admin_validar_evento('a9000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-000000000001', 'Asistencia verificada') ->> 'estado',
  'validado', 'el admin valida un evento que cumple');
select is(pg_temp.saldo('a9000000-0000-0000-0000-000000000001'), 180, 'validar el evento otorga +100');
select is((select vinculo || ':' || clave_unica from public.movimientos_puntos where motivo = 'evento_validado'),
  'eventos:evento:e9000000-0000-0000-0000-000000000001', 'con vínculo al evento y clave evento:{id}');
select throws_ok($$select public.admin_validar_evento('a9000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-000000000001')$$,
  'P0001', 'estado_invalido: el evento ya fue revisado (estado actual: validado)', 'un evento se valida una sola vez');
select is(public.admin_rechazar_evento('a9000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-000000000002', 'Falta el registro de asistentes') ->> 'estado',
  'rechazado', 'el admin rechaza un evento con motivo');

-- Conflictos de Clientify ------------------------------------------------------------------------------------------

insert into public.empresas (id, aliado_id, origen, empresa, sector, nombre_contacto, telefono, correo, valor_factura, es_perfecto, autorizacion_contacto_at)
values ('e9100000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 'hub', 'Conflicto S.A.', 'Industrial', 'C', '3001234567', 'conflicto@admin.test', 1, true, now());
insert into public.avance_empresa (empresa_id, calificado, perfecto, oportunidad_tecnica, integridad_informacion)
values ('e9100000-0000-0000-0000-000000000001', 'no', 'si', 'no', 'no');
insert into public.avance_conflictos (id, empresa_id, variable, valor_hub, valor_clientify)
values ('c9000000-0000-0000-0000-000000000001', 'e9100000-0000-0000-0000-000000000001', 'calificado', 'no', 'si');
select is((public.admin_resolver_conflicto('a9000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-000000000001',
    'Clientify corrigió la calificación', true, 30, 'b9000000-0000-0000-0000-000000000004') ->> 'puntos_aplicados')::integer,
  30, 'resolver un conflicto puede registrar un ajuste de puntos');
select is((select calificado::text from public.avance_empresa where empresa_id = 'e9100000-0000-0000-0000-000000000001'), 'si',
  'y aceptar el valor de Clientify en el avance');
select ok((select resuelto_at is not null and nota = 'Clientify corrigió la calificación' from public.avance_conflictos where id = 'c9000000-0000-0000-0000-000000000001'),
  'el conflicto queda resuelto con su nota');
select throws_ok($$select public.admin_resolver_conflicto('a9000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-000000000001', 'Otra vez resuelto')$$,
  'P0001', 'estado_invalido: el conflicto ya fue resuelto', 'un conflicto se resuelve una sola vez');

-- Auditoría --------------------------------------------------------------------------------------------------------

select is((select count(*) from public.acciones_admin where admin_id = 'a9000000-0000-0000-0000-00000000000a'), 13::bigint,
  'cada acción exitosa queda en acciones_admin (las rechazadas no)');
select throws_ok($$delete from public.acciones_admin$$, 'P0001', null, 'la auditoría es solo inserción');

-- Vistas ------------------------------------------------------------------------------------------------------------

set local role authenticated;
select pg_temp.como('a9000000-0000-0000-0000-000000000001');
select is((select count(*) from public.v_admin_aliados) + (select count(*) from public.v_admin_acciones) + (select count(*) from public.v_admin_resumen), 0::bigint,
  'un aliado no ve las vistas de admin');
select is((select array_agg(nombre_evento order by fecha desc) from public.v_mis_eventos), array['Taller solar Cámara', 'Desayuno empresarial'],
  'el aliado ve sus eventos');
select pg_temp.como('a9000000-0000-0000-0000-00000000000a');
select ok((select aliados_activos >= 5 and referidos_total >= 1 from public.v_admin_resumen), 'el admin ve el resumen global');
select is((select count(*) from public.v_admin_movimientos where creado_por = 'admin:' || (select codigo_aliado from public.aliados where id = 'a9000000-0000-0000-0000-00000000000a')) > 0,
  true, 'el historial de admin muestra el código del admin, no su id');
reset role;

select * from finish();
rollback;
