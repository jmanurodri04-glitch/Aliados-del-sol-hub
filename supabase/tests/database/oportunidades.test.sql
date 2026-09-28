-- Tests de "Nueva oportunidad" desde el Hub y de la cola del flujo B (CLAUDE.md §4.4, §4.5, §5, §7.2, §8).
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

create function pg_temp.aliado(id uuid, email text, celular text, activo boolean)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Aliado Prueba', 'celular', celular, 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
  update public.aliados set estado = 'activo' where aliados.id = aliado.id and activo;
$$;

-- Datos completos de una oportunidad; `extra` cambia o agrega campos.
create function pg_temp.datos(correo text, extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'empresa', 'Industrias Sol', 'sector', 'Industrial', 'subsector', 'Manufactura', 'ciudad', 'Bucaramanga',
    'nombre_contacto', 'Laura Gómez', 'cargo', 'Gerente', 'telefono', '+573105551234', 'correo', correo,
    'valor_factura', 4500000, 'observaciones', 'Planta con cubierta propia', 'autorizacion_contacto', true
  ) || extra;
$$;

-- Simula un archivo ya subido al bucket con la URL firmada.
create function pg_temp.subir(ruta text, tipo text default 'application/pdf', tamano bigint default 1234)
returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata)
  values ('facturas', ruta, jsonb_build_object('mimetype', tipo, 'size', tamano));
$$;

select pg_temp.aliado('a0000000-0000-0000-0000-0000000000a1', 'a@op.test', '+573001110001', true);
select pg_temp.aliado('b0000000-0000-0000-0000-0000000000b1', 'b@op.test', '+573001110002', true);
select pg_temp.aliado('c0000000-0000-0000-0000-0000000000c1', 'c@op.test', '+573001110003', true);
select pg_temp.aliado('d0000000-0000-0000-0000-0000000000d1', 'pendiente@op.test', '+573001110004', false);

-- Bucket -------------------------------------------------------------------------------------------

select row_eq($$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'facturas'$$,
  row(false, 10485760::bigint, array['application/pdf', 'image/jpeg', 'image/png']),
  'bucket facturas privado, 10 MB, solo PDF/JPG/PNG');

-- Referido perfecto (10 campos con factura) --------------------------------------------------------

select pg_temp.subir('a0000000-0000-0000-0000-0000000000a1/e0000000-0000-0000-0000-000000000001/factura.pdf');
create temp table r1 as select public.registrar_oportunidad('a0000000-0000-0000-0000-0000000000a1',
  'e0000000-0000-0000-0000-000000000001', pg_temp.datos('laura@cliente.test'),
  '{"storage_path": "a0000000-0000-0000-0000-0000000000a1/e0000000-0000-0000-0000-000000000001/factura.pdf", "nombre_archivo": "factura.pdf"}') as r;

select is((select r ->> 'es_perfecto' from r1), 'true', 'con los 10 campos y factura es referido perfecto');
select is((select r -> 'movimientos' from r1),
  '[{"motivo": "registro_valido", "tipo": "ganado", "puntos": 10}, {"motivo": "referido_perfecto", "tipo": "ganado", "puntos": 20}]'::jsonb,
  'otorga +10 por registro y +20 por referido perfecto');
select is((select (r ->> 'puntos_disponibles')::int from r1), 30, 'la respuesta trae el saldo actualizado');
select row_eq($$select e.origen, e.autorizacion_contacto_at is not null, f.tipo_documento, f.nombre_archivo, a.perfecto::text, e.correo
                from public.empresas e join public.facturas f on f.id = e.factura_id join public.avance_empresa a on a.empresa_id = e.id
                where e.id = 'e0000000-0000-0000-0000-000000000001'$$,
  row('hub'::text, true, 'pdf'::text, 'factura.pdf'::text, 'si'::text, 'laura@cliente.test'::text),
  'crea empresa (con la declaración del contacto), factura vinculada y avance con perfecto = si');

-- Referido imperfecto ----------------------------------------------------------------------------

create temp table r2 as select public.registrar_oportunidad('a0000000-0000-0000-0000-0000000000a1',
  'e0000000-0000-0000-0000-000000000002', pg_temp.datos('pedro@cliente.test', '{"telefono": "+573105550002"}')) as r;
select is((select r ->> 'es_perfecto' from r2), 'false', 'sin factura es imperfecto');
select is((select r -> 'movimientos' -> 1 ->> 'motivo' from r2), 'referido_imperfecto', 'y resta 5 (referido imperfecto)');
select is((select (r ->> 'puntos_disponibles')::int from r2), 35, 'saldo: 30 + 10 − 5 = 35');

select pg_temp.subir('a0000000-0000-0000-0000-0000000000a1/e0000000-0000-0000-0000-000000000003/f.png', 'image/png');
select is((select public.registrar_oportunidad('a0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-000000000003',
  pg_temp.datos('ana@cliente.test', '{"subsector": "", "telefono": "+573105550003"}'),
  '{"storage_path": "a0000000-0000-0000-0000-0000000000a1/e0000000-0000-0000-0000-000000000003/f.png"}') ->> 'es_perfecto'),
  'false', 'con factura pero sin subsector también es imperfecto');
select is((select tipo_documento from public.facturas where empresa_id = 'e0000000-0000-0000-0000-000000000003'), 'png',
  'el tipo de documento sale del archivo subido');

-- Reglas del programa -----------------------------------------------------------------------------

select throws_like($$select public.registrar_oportunidad('a0000000-0000-0000-0000-0000000000a1', gen_random_uuid(), pg_temp.datos('LAURA@Cliente.test'))$$,
  'referido_duplicado%', 'un contacto ya referido (sin importar mayúsculas) se rechaza');
select throws_like($$select public.registrar_oportunidad('b0000000-0000-0000-0000-0000000000b1', gen_random_uuid(), pg_temp.datos('laura@cliente.test'))$$,
  'referido_duplicado%', 'tampoco otro aliado puede referir el mismo contacto: gana el primero');
select throws_like($$select public.registrar_oportunidad('b0000000-0000-0000-0000-0000000000b1', gen_random_uuid(), pg_temp.datos('B@op.test'))$$,
  'autorreferido%', 'un aliado no puede referirse a sí mismo (correo)');
select throws_like($$select public.registrar_oportunidad('b0000000-0000-0000-0000-0000000000b1', gen_random_uuid(),
  pg_temp.datos('otro@cliente.test', '{"telefono": "+573001110002"}'))$$,
  'autorreferido%', 'ni con su propio celular');
select throws_like($$select public.registrar_oportunidad('d0000000-0000-0000-0000-0000000000d1', gen_random_uuid(), pg_temp.datos('x@cliente.test'))$$,
  'aliado_no_activo%', 'una cuenta pendiente no puede registrar oportunidades');

-- Validaciones -------------------------------------------------------------------------------------

select throws_like($$select public.registrar_oportunidad('c0000000-0000-0000-0000-0000000000c1', gen_random_uuid(), pg_temp.datos('v1@cliente.test', '{"sector": " "}'))$$,
  'oportunidad_invalida%', 'falta un campo obligatorio');
select throws_like($$select public.registrar_oportunidad('c0000000-0000-0000-0000-0000000000c1', gen_random_uuid(), pg_temp.datos('no-es-correo'))$$,
  'oportunidad_invalida%', 'correo inválido');
select throws_like($$select public.registrar_oportunidad('c0000000-0000-0000-0000-0000000000c1', gen_random_uuid(), pg_temp.datos('v3@cliente.test', '{"telefono": "3105551234"}'))$$,
  'oportunidad_invalida%', 'teléfono sin indicativo');
select throws_like($$select public.registrar_oportunidad('c0000000-0000-0000-0000-0000000000c1', gen_random_uuid(), pg_temp.datos('v4@cliente.test', '{"valor_factura": 0}'))$$,
  'oportunidad_invalida%', 'valor de factura en 0');
select throws_like($$select public.registrar_oportunidad('c0000000-0000-0000-0000-0000000000c1', gen_random_uuid(), pg_temp.datos('v5@cliente.test', '{"autorizacion_contacto": false}'))$$,
  'oportunidad_invalida%', 'sin la declaración de autorización del contacto (Ley 1581)');
select throws_like($$select public.registrar_oportunidad('c0000000-0000-0000-0000-0000000000c1', gen_random_uuid(), pg_temp.datos('v6@cliente.test'),
  '{"storage_path": "a0000000-0000-0000-0000-0000000000a1/e0000000-0000-0000-0000-000000000001/factura.pdf"}')$$,
  'factura_invalida%', 'no puede usar la factura de otro aliado');
select throws_like($$select public.registrar_oportunidad('c0000000-0000-0000-0000-0000000000c1', 'e0000000-0000-0000-0000-000000000009', pg_temp.datos('v7@cliente.test'),
  '{"storage_path": "c0000000-0000-0000-0000-0000000000c1/e0000000-0000-0000-0000-000000000009/no-subida.pdf"}')$$,
  'factura_invalida%', 'la factura debe haberse subido');
select pg_temp.subir('c0000000-0000-0000-0000-0000000000c1/e0000000-0000-0000-0000-000000000008/f.gif', 'image/gif');
select throws_like($$select public.registrar_oportunidad('c0000000-0000-0000-0000-0000000000c1', 'e0000000-0000-0000-0000-000000000008', pg_temp.datos('v8@cliente.test'),
  '{"storage_path": "c0000000-0000-0000-0000-0000000000c1/e0000000-0000-0000-0000-000000000008/f.gif"}')$$,
  'factura_invalida%', 'solo PDF, JPG o PNG');
select is((select count(*) from public.empresas where aliado_id = 'c0000000-0000-0000-0000-0000000000c1')
          + (select count(*) from public.movimientos_puntos where aliado_id = 'c0000000-0000-0000-0000-0000000000c1'),
  0::bigint, 'un envío rechazado no deja nada guardado (todo o nada)');

-- Límite de 20 referidos por hora -------------------------------------------------------------------

insert into public.empresas (aliado_id, origen, empresa, sector, nombre_contacto, telefono, correo, valor_factura, es_perfecto, autorizacion_contacto_at)
select 'c0000000-0000-0000-0000-0000000000c1', 'hub', 'E' || g, 'Industrial', 'C', '+573100000000', 'lim' || g || '@cliente.test', 1, false, now()
from generate_series(1, 20) g;
select throws_like($$select public.registrar_oportunidad('c0000000-0000-0000-0000-0000000000c1', gen_random_uuid(), pg_temp.datos('lim21@cliente.test'))$$,
  'limite_referidos%', 'el referido 21 en una hora se rechaza');

-- Cola del flujo B ----------------------------------------------------------------------------------

delete from public.empresas where aliado_id = 'c0000000-0000-0000-0000-0000000000c1';
select results_eq($$select empresa_id from public.clientify_reclamar_empresas(10, 'e0000000-0000-0000-0000-000000000003')$$,
  array['e0000000-0000-0000-0000-000000000003'::uuid], 'se puede reclamar una empresa específica (sincronización inmediata)');
create temp table lote as select * from public.clientify_reclamar_empresas(10);
select is((select count(*) from lote), 2::bigint, 'la cola trae las otras 2 oportunidades del Hub pendientes');
select row_eq($$select codigo_aliado like 'EM%', factura_storage_path, factura_tipo, factura_subida from lote where empresa_id = 'e0000000-0000-0000-0000-000000000001'$$,
  row(true, 'a0000000-0000-0000-0000-0000000000a1/e0000000-0000-0000-0000-000000000001/factura.pdf'::text, 'pdf'::text, false),
  'con el código del aliado (para ID_aliado) y la factura por subir');
select is((select count(*) from public.clientify_reclamar_empresas(10)), 0::bigint, 'las reclamadas quedan prestadas');

select public.clientify_registrar_resultado_empresa('e0000000-0000-0000-0000-000000000001', '555', null, false, 'Falló el contacto');
select row_eq($$select clientify_company_id, clientify_contact_id, clientify_sync_estado, clientify_sync_intentos from public.empresas where id = 'e0000000-0000-0000-0000-000000000001'$$,
  row('555'::text, null::text, 'error'::text, 1), 'un error parcial guarda la empresa ya creada para no duplicarla al reintentar');

select public.clientify_registrar_resultado_empresa('e0000000-0000-0000-0000-000000000001', '555', '777', true, null);
select row_eq($$select e.clientify_sync_estado, e.clientify_contact_id, f.clientify_subida_at is not null
                from public.empresas e join public.facturas f on f.id = e.factura_id where e.id = 'e0000000-0000-0000-0000-000000000001'$$,
  row('ok'::text, '777'::text, true), 'éxito: empresa y contacto vinculados y factura adjunta');
select throws_ok($$select public.clientify_registrar_resultado_empresa('e0000000-0000-0000-0000-000000000002', '1', null)$$,
  'P0001', null, 'un éxito exige los IDs de empresa y contacto');

-- Permisos --------------------------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.registrar_oportunidad(uuid, uuid, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.clientify_reclamar_empresas(integer, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.registrar_oportunidad(uuid, uuid, jsonb, jsonb)', 'execute'),
  'solo el servidor registra oportunidades y sincroniza (el aliado_id sale de la sesión, nunca del navegador)'
);

select * from finish();
rollback;
