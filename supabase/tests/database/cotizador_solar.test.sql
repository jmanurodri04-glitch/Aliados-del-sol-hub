-- Tests del Cotizador Solar: solo aliados, nombre único por aliado, edición en la misma fila, +5 por solicitar la
-- propuesta, preguntas antes del PDF, cola de Clientify, borrado desde el panel (solo > 12 meses) y permisos
-- (CLAUDE.md §7.5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

create function pg_temp.fila(extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'telefono', '+573001234567', 'correo', 'ana+prueba@empresa.test', 'ciudad', 'Barranquilla', 'departamento', 'Atlántico',
    'region', 'Costa', 'unidad', 'cop', 'consumo_kwh_mes', 14492.8, 'valor_factura_cop', 10000000, 'conectado_red', true,
    'almacenamiento', 'none', 'potencia_kwp', 110.7, 'modulos', 180, 'inversores', 2, 'generacion_kwh_mes', 11657,
    'cobertura_pct', 80, 'ahorro_anual_cop', 96517559, 'payback_anios', 3.9, 'co2_t_anio', 22.94, 'almacenamiento_kwh', 0,
    'area_minima_m2', 649, 'inversion_total_cop', 377266000) || extra;
$$;
create function pg_temp.empresa(p_nombre text, extra jsonb default '{}')
returns jsonb language sql as $$
  select pg_temp.fila(jsonb_build_object('empresa', p_nombre, 'contacto', 'Ana Pérez', 'subsector', 'Plásticos') || extra);
$$;
create function pg_temp.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.crear(p_id uuid, p_correo text, p_celular text, p_rol text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (p_id, p_correo,
    jsonb_build_object('nombre_completo', 'Aliado ' || p_rol, 'celular', p_celular, 'tipo_aliado', 'emi',
      'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
  update public.aliados set estado = 'activo', rol = p_rol where id = p_id;
$$;

-- A y B: aliados; Z: admin
select pg_temp.crear('c0000000-0000-0000-0000-00000000000a', 'a@cotizador.test', '+573002230001', 'aliado');
select pg_temp.crear('c0000000-0000-0000-0000-00000000000b', 'b@cotizador.test', '+573002230002', 'aliado');
select pg_temp.crear('c0000000-0000-0000-0000-00000000000f', 'z@cotizador.test', '+573002230003', 'admin');
create temp table ids (k text primary key, id uuid);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from ids where k = p_k $$;

-- Límite de intentos
select ok(public.cotizador_intento(repeat('c', 64), 2) and public.cotizador_intento(repeat('c', 64), 2), 'dos intentos dentro del límite');
select ok(not public.cotizador_intento(repeat('c', 64), 2), 'el tercero supera el límite de la hora');

-- Guardar: a nombre del aliado, en la tabla de su tipo
insert into ids select 'ind', public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000a', 'industrial',
  pg_temp.empresa('Plásticos del Caribe', '{"id": "c0000000-0000-0000-0000-0000000000ff", "aliado_id": "c0000000-0000-0000-0000-00000000000b",
    "clientify_sync_estado": "ok", "politica_datos_version": "x", "meddpicc": {"v": 1, "respuestas": {}}}'));
insert into ids select 'res', public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000a', 'residencial',
  pg_temp.fila('{"nombre": "Juan Gómez", "conectado_red": false, "almacenamiento": "autonomia", "ahorro_anual_cop": null, "payback_anios": null}'));

select is((select count(*)::int from public.cotizador_industrial), 1, 'la cotización industrial va a su tabla');
select is((select count(*)::int from public.cotizador_comercial), 0, 'la tabla comercial no recibe filas de otro tipo');
select isnt(pg_temp.id('ind'), 'c0000000-0000-0000-0000-0000000000ff'::uuid, 'el id lo pone la base, no el servidor');
select is((select aliado_id from public.cotizador_industrial), 'c0000000-0000-0000-0000-00000000000a'::uuid, 'el aliado es el de la sesión, no el de la fila');
select ok((select clientify_sync_estado is null and meddpicc is null from public.cotizador_industrial), 'sin propuesta no entra a la cola; las preguntas no vienen en la fila');
select is((select politica_datos_version from public.cotizador_industrial), interno.version_politica_datos_vigente(), 'guarda la versión vigente de la política');
select is((select nombre_normalizado from public.cotizador_industrial), 'plasticos del caribe', 'el nombre se normaliza (mayúsculas, tildes y espacios)');
select ok((select ahorro_anual_cop is null and payback_anios is null and not conectado_red from public.cotizador_residencial), 'un sistema aislado no guarda ahorro ni retorno');
select throws_like($$select public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000a', 'residencial', pg_temp.fila('{"nombre": "Otro", "telefono": "+572001234567"}'))$$,
  '%cotizador_residencial_telefono_check%', 'un celular de Colombia que no empieza por 3 se rechaza');
select throws_ok($$select public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000a', 'otro', pg_temp.fila())$$,
  'P0001', 'dato_invalido: tipo de proyecto inválido', 'solo hay tres tipos de proyecto');
select throws_ok($$select public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000f', 'industrial', pg_temp.empresa('Admin SAS'))$$,
  'P0001', 'aliado_no_activo: el cotizador es solo para aliados activos', 'un admin no cotiza (no gana puntos)');
update public.aliados set estado = 'suspendido' where id = 'c0000000-0000-0000-0000-00000000000b';
select throws_ok($$select public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000b', 'industrial', pg_temp.empresa('Otra SAS'))$$,
  'P0001', 'aliado_no_activo: el cotizador es solo para aliados activos', 'una cuenta suspendida no cotiza');
update public.aliados set estado = 'activo' where id = 'c0000000-0000-0000-0000-00000000000b';

-- Nombre único por aliado (entre los tres tipos)
select throws_ok($$select public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000a', 'comercial', pg_temp.empresa('  PLASTICOS del  caribe '))$$,
  'P0001', 'nombre_repetido: ya tienes una cotización con ese nombre', 'el mismo aliado no repite el nombre, aunque cambie el tipo o las tildes');
select throws_ok($$select public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000a', 'comercial', pg_temp.empresa('Juan Gómez'))$$,
  'P0001', 'nombre_repetido: ya tienes una cotización con ese nombre', 'el nombre de una persona (residencial) cuenta igual que una empresa');
insert into ids select 'b', public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000b', 'industrial', pg_temp.empresa('Plásticos del Caribe'));
select ok(pg_temp.id('b') is not null, 'otro aliado sí puede usar el mismo nombre');
select ok(not public.cotizador_nombre_disponible('c0000000-0000-0000-0000-00000000000a', 'Plásticos del Caribe'), 'paso 2: el nombre ya está usado');
select ok(public.cotizador_nombre_disponible('c0000000-0000-0000-0000-00000000000a', 'Plásticos del Caribe', pg_temp.id('ind')), 'paso 2: su propio nombre sirve al editar');
select ok(public.cotizador_nombre_disponible('c0000000-0000-0000-0000-00000000000a', 'Plásticos del Caribe 2'), 'paso 2: con un número queda libre');

-- Edición en la misma fila hasta pedir la propuesta
select is(public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000a', 'industrial', pg_temp.empresa('Plásticos del Caribe', '{"modulos": 200}'), pg_temp.id('ind')),
  pg_temp.id('ind'), 'editar devuelve el mismo id');
select ok((select count(*) = 1 and max(modulos) = 200 and bool_and(actualizada_at is not null) from public.cotizador_industrial where aliado_id = 'c0000000-0000-0000-0000-00000000000a'),
  'editar actualiza la fila en vez de crear otra');
select isnt(public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000a', 'industrial', pg_temp.empresa('Cartón Andino'), pg_temp.id('b')),
  pg_temp.id('b'), 'el id de otro aliado no se edita: se crea una cotización nueva');

-- Propuesta: +5 la primera vez
select is(public.cotizador_solicitar_propuesta('c0000000-0000-0000-0000-00000000000a', 'industrial', pg_temp.id('ind')),
  '{"estado": "pendiente", "puntos": 5}'::jsonb, 'pedir la propuesta la pone en la cola y da +5');
select is(public.cotizador_solicitar_propuesta('c0000000-0000-0000-0000-00000000000a', 'industrial', pg_temp.id('ind')),
  '{"estado": "pendiente", "puntos": 0}'::jsonb, 'pedirla otra vez no la duplica ni da más puntos');
select is((select count(*)::int from public.movimientos_puntos where aliado_id = 'c0000000-0000-0000-0000-00000000000a' and motivo = 'uso_cotizador' and puntos = 5 and vinculo = 'cotizador'),
  1, 'un solo movimiento de +5 (uso_cotizador)');
select throws_ok(format($$select public.cotizador_solicitar_propuesta('c0000000-0000-0000-0000-00000000000b', 'industrial', %L)$$, pg_temp.id('ind')),
  'P0001', 'simulacion_inexistente: la simulación no existe o ya venció', 'un aliado no pide la propuesta de otro');
select throws_ok(format($$select public.cotizador_guardar_simulacion('c0000000-0000-0000-0000-00000000000a', 'industrial', pg_temp.empresa('Plásticos del Caribe'), %L)$$, pg_temp.id('ind')),
  'P0001', 'nombre_repetido: ya tienes una cotización con ese nombre', 'ya pedida, un cambio se guarda como otra cotización (con otro nombre)');

-- Preguntas antes del PDF
select lives_ok(format($$select public.cotizador_guardar_meddpicc('c0000000-0000-0000-0000-00000000000a', 'industrial', %L, '{"v": 1, "respuestas": {"cuando": {"o": ["mes"]}}}')$$, pg_temp.id('ind')),
  'guarda las respuestas con la cotización');
select ok((select meddpicc -> 'respuestas' ? 'cuando' and meddpicc_at is not null from public.cotizador_industrial where id = pg_temp.id('ind')), 'quedan en la fila');
select throws_ok(format($$select public.cotizador_guardar_meddpicc('c0000000-0000-0000-0000-00000000000b', 'industrial', %L, '{"v": 1, "respuestas": {}}')$$, pg_temp.id('ind')),
  'P0001', 'simulacion_inexistente: la cotización no existe', 'un aliado no responde por la cotización de otro');
select throws_ok(format($$select public.cotizador_guardar_meddpicc('c0000000-0000-0000-0000-00000000000a', 'industrial', %L, '{"v": 1}')$$, pg_temp.id('ind')),
  'P0001', 'dato_invalido: faltan las respuestas', 'sin respuestas no se guarda');

-- Comparador: las cotizaciones del aliado, sin teléfono ni correo
select is(jsonb_array_length(public.cotizador_mis_cotizaciones('c0000000-0000-0000-0000-00000000000a')), 3, 'el aliado ve solo sus cotizaciones');
select ok(not (public.cotizador_mis_cotizaciones('c0000000-0000-0000-0000-00000000000a') -> 0 ?| array['telefono', 'correo', 'aliado_id']), 'sin datos de contacto ni el id interno');

-- Cola de Clientify
select ok((select bool_and(not (p ? 'aliado_id') and p ->> 'codigo_aliado' is not null and p ? 'meddpicc') from public.cotizador_reclamar_propuestas(10) p),
  'la cola entrega el código del aliado y las respuestas, nunca su id');
select is((select count(*)::int from public.cotizador_reclamar_propuestas(10)), 0, 'prestada por 10 minutos: no se entrega dos veces');
select public.cotizador_resultado_propuesta('industrial', pg_temp.id('ind'), null, 'Clientify 500');
select ok((select clientify_sync_estado = 'error' and clientify_sync_intentos = 1 from public.cotizador_industrial where id = pg_temp.id('ind')), 'un error programa el reintento');
update public.cotizador_industrial set clientify_sync_proximo_at = now();
select public.cotizador_resultado_propuesta('industrial', pg_temp.id('ind'), '987', null);
select ok((select clientify_sync_estado = 'ok' and clientify_contact_id = '987' from public.cotizador_industrial where id = pg_temp.id('ind')), 'el éxito guarda el contacto de Clientify');

-- Borrado desde el panel: solo lo de más de 12 meses y nunca lo que no llegó a Clientify
select is(public.admin_cotizador_borrar('c0000000-0000-0000-0000-00000000000f', 'industrial', now() - interval '2 years', now() + interval '1 minute'),
  '{"borradas": 0, "sin_enviar": 0, "recientes": 3}'::jsonb, 'lo de los últimos 12 meses no se borra');
update public.cotizador_industrial set created_at = now() - interval '13 months' where id = pg_temp.id('ind');
select public.cotizador_solicitar_propuesta('c0000000-0000-0000-0000-00000000000b', 'industrial', pg_temp.id('b'));
update public.cotizador_industrial set created_at = now() - interval '14 months' where id = pg_temp.id('b');
select is(public.admin_cotizador_borrar('c0000000-0000-0000-0000-00000000000f', 'industrial', now() - interval '2 years', now() + interval '1 minute'),
  '{"borradas": 1, "sin_enviar": 1, "recientes": 1}'::jsonb, 'borra lo viejo ya enviado y conserva lo pendiente de Clientify');
select is((select count(*)::int from public.acciones_admin where accion = 'borrar_cotizaciones'), 2, 'cada borrado queda en la auditoría');

-- Permisos
set local role anon;
select throws_ok($$select count(*) from public.cotizador_residencial$$, '42501', null, 'sin sesión no se leen las cotizaciones');
reset role;
set local role authenticated;
select pg_temp.como('c0000000-0000-0000-0000-00000000000a');
select throws_ok($$select public.cotizador_mis_cotizaciones('c0000000-0000-0000-0000-00000000000b')$$, '42501', null, 'un aliado no llama las funciones del servidor');
select is((select count(*)::int from public.v_admin_cotizador_aliados), 0, 'un aliado no ve el uso por aliado');
select pg_temp.como('c0000000-0000-0000-0000-00000000000f');
select ok((select cotizaciones = 2 and solicitudes = 0 and puntos_cotizador = 5 from public.v_admin_cotizador_aliados where codigo_aliado =
  (select codigo_aliado from public.aliados where id = 'c0000000-0000-0000-0000-00000000000a')), 'un admin ve el uso y los puntos de cada aliado (lo borrado ya no cuenta; los puntos se conservan)');
reset role;

select * from finish();
rollback;
