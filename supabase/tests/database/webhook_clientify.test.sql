-- Tests del webhook de Clientify (flujo C): cola, leads del formulario público, aplicación del avance,
-- conflictos, retención, conciliación y depuración (CLAUDE.md §4.7, §5, §5.1, §7.1, §8).
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

create function pg_temp.aliado(id uuid, email text, celular text, estado text)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Aliado Webhook', 'celular', celular, 'tipo_aliado', 'linker',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
  update public.aliados set estado = aliado.estado where aliados.id = aliado.id;
$$;
create function pg_temp.codigo(id uuid) returns text language sql as $$
  select codigo_aliado from public.aliados where aliados.id = codigo.id;
$$;
create function pg_temp.empresa_de(contacto text) returns uuid language sql as $$
  select id from public.empresas where clientify_contact_id = contacto;
$$;
create function pg_temp.motivos(empresa uuid) returns text[] language sql as $$
  select coalesce(array_agg(motivo order by secuencia), '{}') from public.movimientos_puntos
  where vinculo = 'empresas' and vinculo_id = empresa::text;
$$;
create function pg_temp.lead(contacto text, correo text) returns jsonb language sql as $$
  select jsonb_build_object('empresa', 'Lead ' || contacto, 'nombre_contacto', 'Contacto ' || contacto, 'correo', correo);
$$;

select pg_temp.aliado('a6000000-0000-0000-0000-0000000000a6', 'a@wh.test', '+573002220001', 'activo');
select pg_temp.aliado('b6000000-0000-0000-0000-0000000000b6', 'b@wh.test', '+573002220002', 'activo');
select pg_temp.aliado('c6000000-0000-0000-0000-0000000000c6', 's@wh.test', '+573002220003', 'suspendido');

-- Recepción y cola ---------------------------------------------------------------------------------

select isnt(public.webhook_clientify_recibir('{"evento": 1}', 'contacto', '101', 'contact.created', 120), null,
  'el evento se guarda y devuelve su id');
select public.webhook_clientify_recibir('{"evento": 2}', 'contacto', '101', 'contact.updated', 120);
select is((select count(*) from public.webhook_eventos where entidad_id = '101'), 2::bigint, 'se guardan todos los eventos crudos');
select is((select count(*) from public.clientify_cola_entidades where entidad_id = '101'), 1::bigint,
  'varios eventos del mismo contacto quedan en una sola fila de la cola');
select ok((select programado_at > now() + interval '100 seconds' from public.clientify_cola_entidades where entidad_id = '101'),
  'un contacto nuevo espera ~2 minutos (deduplicación con el flujo B)');

select public.webhook_clientify_recibir('{"raro": true}', null, null, null, 0);
select row_eq($$select procesado_at is not null, error from public.webhook_eventos where payload = '{"raro": true}'$$,
  row(true, 'No se reconoció el contacto o la oportunidad del evento'::text),
  'un evento sin entidad reconocible queda cerrado con error para revisión');

select is((select count(*) from public.clientify_reclamar_entidades(10)), 0::bigint, 'lo programado a futuro no se reclama');
select public.webhook_clientify_recibir('{"evento": 3}', 'oportunidad', '201', 'deal.updated', 0);
create temp table reclamo as select * from public.clientify_reclamar_entidades(10);
select row_eq('select entidad, entidad_id, origen from reclamo', row('oportunidad'::text, '201'::text, 'webhook'::text),
  'se reclama la entidad que ya toca');
select is((select count(*) from public.clientify_reclamar_entidades(10)), 0::bigint, 'lo reclamado queda prestado');

-- Error: se reintenta con espera y el evento sigue pendiente.
select public.clientify_resultado_entidad('oportunidad', '201', (select reclamado_at from reclamo), 'Clientify respondió 503');
select row_eq($$select intentos, error, programado_at > now() + interval '100 seconds' from public.clientify_cola_entidades where entidad_id = '201'$$,
  row(1, 'Clientify respondió 503'::text, true), 'un error programa el reintento');
select is((select count(*) from public.webhook_eventos where entidad_id = '201' and procesado_at is null), 1::bigint,
  'con error el evento sigue pendiente');

-- Éxito con aviso: sale de la cola y el evento queda procesado con la nota.
select public.clientify_resultado_entidad('oportunidad', '201', now(), null, 'Fase desconocida: "8. Otra"');
select is((select count(*) from public.clientify_cola_entidades where entidad_id = '201'), 0::bigint, 'al terminar sale de la cola');
select row_eq($$select procesado_at is not null, error from public.webhook_eventos where entidad_id = '201'$$,
  row(true, 'Fase desconocida: "8. Otra"'::text), 'el aviso queda en el evento procesado');

-- Si llegó otro evento mientras se procesaba, la fila se conserva.
select public.clientify_encolar_entidad('oportunidad', '202', 0);
select public.clientify_resultado_entidad('oportunidad', '202', now() - interval '1 second');
select is((select count(*) from public.clientify_cola_entidades where entidad_id = '202'), 1::bigint,
  'un evento posterior al reclamo no se pierde');

-- Leads del formulario público -----------------------------------------------------------------------

select throws_like($$select public.clientify_registrar_lead('LKNOEXISTE234', '900', pg_temp.lead('900', 'x@lead.test'))$$,
  'aliado_inexistente:%', 'un ID_aliado que no existe no crea nada');

select is((public.clientify_registrar_lead(pg_temp.codigo('a6000000-0000-0000-0000-0000000000a6'), '101',
  pg_temp.lead('101', 'uno@lead.test')) ->> 'creada')::boolean, true, 'lead nuevo del formulario: se crea la empresa');
select row_eq($$select e.origen, e.aliado_id, a.perfecto from public.empresas e join public.avance_empresa a on a.empresa_id = e.id
                where e.clientify_contact_id = '101'$$,
  row('clientify_form'::text, 'a6000000-0000-0000-0000-0000000000a6'::uuid, 'revision'::public.estado_triple),
  'origen clientify_form y perfecto en revisión (lo define la etiqueta)');
select is(pg_temp.motivos(pg_temp.empresa_de('101')), array['registro_valido'], '+10 por registro válido');
select is((public.clientify_registrar_lead(pg_temp.codigo('a6000000-0000-0000-0000-0000000000a6'), '101',
  pg_temp.lead('101', 'uno@lead.test')) ->> 'creada')::boolean, false, 'el mismo contacto no crea otra empresa');
select is(pg_temp.motivos(pg_temp.empresa_de('101')), array['registro_valido'], 'ni otro registro válido');

select throws_like($$select public.clientify_registrar_lead(pg_temp.codigo('b6000000-0000-0000-0000-0000000000b6'), '102',
  pg_temp.lead('102', 'UNO@lead.test'))$$, 'referido_duplicado:%', 'el mismo correo de otro aliado: gana el primero');

-- Referido del Hub que aún no tiene el ID del contacto: se vincula (flujo B, deduplicación).
select public.registrar_oportunidad('a6000000-0000-0000-0000-0000000000a6', 'e6000000-0000-0000-0000-0000000000e6',
  jsonb_build_object('empresa', 'Del Hub', 'sector', 'Industrial', 'nombre_contacto', 'Hub Contacto', 'telefono', '+573105550000',
                     'correo', 'hub@lead.test', 'valor_factura', 900000, 'autorizacion_contacto', true));
select row_eq($$select (public.clientify_registrar_lead(pg_temp.codigo('a6000000-0000-0000-0000-0000000000a6'), '103',
                  pg_temp.lead('103', 'hub@lead.test')) ->> 'vinculada')::boolean$$, row(true),
  'el lead que el Hub ya había registrado se vincula por correo');
select is(pg_temp.empresa_de('103'), 'e6000000-0000-0000-0000-0000000000e6'::uuid, 'queda con el ID del contacto de Clientify');
select is(pg_temp.motivos('e6000000-0000-0000-0000-0000000000e6'), array['registro_valido', 'referido_imperfecto'],
  'no se otorga un segundo registro válido');

-- Aliado suspendido: la empresa se crea y los puntos quedan retenidos (§4.7).
select public.clientify_registrar_lead(pg_temp.codigo('c6000000-0000-0000-0000-0000000000c6'), '104', pg_temp.lead('104', 's@lead.test'));
select row_eq($$select (select count(*) from public.movimientos_retenidos where vinculo_id = pg_temp.empresa_de('104')::text),
                       (select count(*) from public.movimientos_puntos where vinculo_id = pg_temp.empresa_de('104')::text)$$,
  row(1::bigint, 0::bigint), 'aliado suspendido: el +10 queda retenido');

-- Formulario sin sector ni valor: se acepta; en el Hub siguen siendo obligatorios.
select throws_ok($$insert into public.empresas (aliado_id, origen, empresa, nombre_contacto, telefono, correo, valor_factura, es_perfecto, autorizacion_contacto_at)
                  values ('a6000000-0000-0000-0000-0000000000a6', 'hub', 'Sin sector', 'X', '+573100000000', 'sinsector@x.test', 1, false, now())$$,
  '23514', null, 'una empresa del Hub sin sector se rechaza');

-- Aplicación del avance --------------------------------------------------------------------------------

create temp table r1 as select public.aplicar_avance_clientify(pg_temp.empresa_de('101'),
  '{"estado_contacto_clientify": "3. lead caliente", "fase_oportunidad": "6. Presentación de oferta", "fase_oportunidad_num": 6,
    "estado_oportunidad": "abierta", "valor_oportunidad": 120000000, "lead_scoring": 72}',
  '{"calificado": "si", "perfecto": "si", "fuera_perfil": "no", "oportunidad_tecnica": "si", "propuesta_comercial": "si",
    "negocio_cerrado": "revision", "informacion_falsa": "revision", "integridad_informacion": "si"}',
  '301') as r;

select is(pg_temp.motivos(pg_temp.empresa_de('101')),
  array['registro_valido', 'empresa_calificada', 'referido_perfecto', 'evaluacion_tecnica', 'propuesta_comercial'],
  'saltos de fase: se otorgan todos los movimientos pendientes, en el orden de §8');
select is((select puntos_disponibles from public.aliados where id = 'a6000000-0000-0000-0000-0000000000a6'),
  140 + 5, 'saldo: +10 +30 +20 +30 +50 del lead y +10 −5 del referido del Hub');
select row_eq($$select calificado, negocio_cerrado, calidad_empresa, fecha_calificado is not null, fase_oportunidad_num,
                       estado_oportunidad, valor_oportunidad, lead_scoring
                from public.avance_empresa where empresa_id = pg_temp.empresa_de('101')$$,
  row('si'::public.estado_triple, 'revision'::public.estado_triple, 100.00::numeric(5,2), true, 6, 'abierta'::text, 120000000::numeric, 72::numeric),
  'variables, calidad 100, fecha de calificación y datos crudos guardados');
select is((select clientify_deal_id from public.empresas where clientify_contact_id = '101'), '301', 'se guarda la oportunidad más avanzada');
select is((select calidad_referidos from public.aliados where id = 'a6000000-0000-0000-0000-0000000000a6'), 100.00::numeric(5,2),
  'la calidad del aliado se recalcula');

-- Repetir el mismo evento no hace nada (§5.1).
select is((public.aplicar_avance_clientify(pg_temp.empresa_de('101'), '{}',
  '{"calificado": "si", "perfecto": "si", "oportunidad_tecnica": "si", "propuesta_comercial": "si"}') -> 'movimientos'),
  '[]'::jsonb, 'un evento repetido no genera movimientos');
select is((select fase_oportunidad_num from public.avance_empresa where empresa_id = pg_temp.empresa_de('101')), 6,
  'las claves crudas ausentes no borran lo guardado');

-- revision nunca cambia nada; un retroceso es un conflicto.
select public.aplicar_avance_clientify(pg_temp.empresa_de('101'), '{}', '{"calificado": "revision"}');
select is((select calificado from public.avance_empresa where empresa_id = pg_temp.empresa_de('101')), 'si'::public.estado_triple,
  'revision no cambia un valor definitivo');
select is((public.aplicar_avance_clientify(pg_temp.empresa_de('101'), '{"estado_contacto_clientify": "0. lead no calificado"}',
  '{"calificado": "no", "integridad_informacion": "no"}') -> 'conflictos' -> 0 ->> 'variable'), 'calificado',
  'Clientify retrocede calificado: se reporta el conflicto');
select public.aplicar_avance_clientify(pg_temp.empresa_de('101'), '{}', '{"calificado": "no"}');
select row_eq($$select count(*), min(valor_hub::text), min(valor_clientify::text) from public.avance_conflictos
                where empresa_id = pg_temp.empresa_de('101') and variable = 'calificado' and resuelto_at is null$$,
  row(1::bigint, 'si'::text, 'no'::text), 'un solo conflicto abierto aunque se repita');
select row_eq($$select a.calificado, a.estado_contacto_clientify, (select count(*) from public.movimientos_puntos m
                  where m.clave_unica = 'empresa:' || a.empresa_id || ':calificado') from public.avance_empresa a
                where a.empresa_id = pg_temp.empresa_de('101')$$,
  row('si'::public.estado_triple, '0. lead no calificado'::text, 1::bigint),
  'el conflicto no cambia la variable ni los puntos; el dato crudo sí se actualiza');

-- Fuera del perfil: −10 y −15 = −25 (§5).
select public.clientify_registrar_lead(pg_temp.codigo('b6000000-0000-0000-0000-0000000000b6'), '105', pg_temp.lead('105', 'fuera@lead.test'));
select public.aplicar_avance_clientify(pg_temp.empresa_de('105'), '{"estado_contacto_clientify": "0. lead no calificado"}',
  '{"calificado": "no", "perfecto": "si", "fuera_perfil": "si", "oportunidad_tecnica": "no", "integridad_informacion": "no"}');
select is(pg_temp.motivos(pg_temp.empresa_de('105')),
  array['registro_valido', 'referido_no_calificado', 'referido_perfecto', 'fuera_perfil'],
  'no calificado + perfecto: −10 y −15 como movimientos independientes');
select row_eq($$select puntos_disponibles, (select calidad_empresa from public.avance_empresa where empresa_id = pg_temp.empresa_de('105'))
                from public.aliados where id = 'b6000000-0000-0000-0000-0000000000b6'$$,
  row(5, 30.00::numeric(5,2)), 'saldo 10 − 10 + 20 − 15 = 5 y calidad 30');
select is((select fecha_calificado from public.avance_empresa where empresa_id = pg_temp.empresa_de('105')), null,
  'no calificado no registra fecha de calificación');

-- Aliado suspendido: el avance se aplica y los puntos quedan retenidos.
select public.aplicar_avance_clientify(pg_temp.empresa_de('104'), '{}', '{"calificado": "si"}');
select is((select count(*) from public.movimientos_retenidos where vinculo_id = pg_temp.empresa_de('104')::text), 2::bigint,
  'suspendido: el +30 de calificación también queda retenido');

select throws_like($$select public.aplicar_avance_clientify('00000000-0000-0000-0000-000000000000', '{}', '{}')$$,
  'empresa_inexistente:%', 'una empresa inexistente se rechaza');

-- Conciliación ------------------------------------------------------------------------------------------

delete from public.clientify_cola_entidades;
update public.avance_empresa set negocio_cerrado = 'si' where empresa_id = pg_temp.empresa_de('105');
select is(public.clientify_encolar_conciliacion(),
  (select count(*)::integer from public.empresas e join public.avance_empresa a on a.empresa_id = e.id
   where e.clientify_contact_id is not null and a.negocio_cerrado <> 'si'),
  'la conciliación encola los referidos en curso');
select is((select count(*) from public.clientify_cola_entidades where entidad_id = '105'), 0::bigint,
  'un negocio cerrado no se reconcilia');
select is((select count(*) from public.clientify_cola_entidades where origen = 'conciliacion' and entidad_id in ('101', '103', '104')), 3::bigint,
  'los contactos en curso quedan en la cola con origen conciliación');
select is(public.clientify_encolar_conciliacion(), 0, 'repetirla no duplica la cola');

-- Depuración de payloads (90 días) --------------------------------------------------------------------------

insert into public.webhook_eventos (payload, recibido_at, procesado_at) values ('{"correo": "viejo@x.test"}', now() - interval '91 days', now() - interval '91 days');
select ok(interno.depurar_webhooks_clientify() >= 1, 'se depuran los eventos de más de 90 días');
select is((select count(*) from public.webhook_eventos where payload ? 'correo' and recibido_at < now() - interval '90 days'), 0::bigint,
  'no quedan datos personales en eventos viejos');
select is((select count(*) from public.webhook_eventos where entidad_id = '101' and payload ? 'evento'), 2::bigint,
  'los eventos recientes se conservan');

-- Seguridad y programación ------------------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'public.aplicar_avance_clientify(uuid, jsonb, jsonb, text)', 'execute'),
  'un usuario autenticado no puede aplicar avance');
select ok(not has_function_privilege('anon', 'public.webhook_clientify_recibir(jsonb, text, text, text, integer)', 'execute'),
  'nadie anónimo puede registrar eventos');
select ok(not has_table_privilege('authenticated', 'public.clientify_cola_entidades', 'select'), 'la cola no es legible desde el navegador');
select is((select schedule from cron.job where jobname = 'sincronizar-clientify-aliados'), '*/2 * * * *',
  'el job de sincronización corre cada 2 minutos');
select is((select schedule from cron.job where jobname = 'depurar-webhooks-clientify'), '30 8 1 * *',
  'la depuración corre el día 1 de cada mes');

select * from finish();
rollback;
