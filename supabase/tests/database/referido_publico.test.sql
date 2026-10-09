-- Tests del referido desde el formulario público del Hub (migración referido_publico; CLAUDE.md §7.1, §7.2).
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

create function pg_temp.aliado(id uuid, email text, celular text, estado text)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Aliado Prueba', 'celular', celular, 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
  update public.aliados set estado = aliado.estado where aliados.id = aliado.id and aliado.estado <> 'pendiente';
$$;

create function pg_temp.datos(correo text, extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'empresa', 'Industrias Sol', 'sector', 'Industrial', 'subsector', 'Manufactura', 'ciudad', 'Bucaramanga',
    'nombre_contacto', 'Laura Gómez', 'cargo', 'Gerente', 'telefono', '+573105551234', 'correo', correo,
    'valor_factura', 4500000, 'observaciones', null, 'autorizacion_contacto', true
  ) || extra;
$$;

create function pg_temp.subir(ruta text)
returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata)
  values ('facturas', ruta, jsonb_build_object('mimetype', 'application/pdf', 'size', 1234));
$$;

-- Huellas de conexión de prueba (64 hex).
create function pg_temp.huella(n integer)
returns text language sql as $$ select lpad(to_hex(n), 64, '0'); $$;

select pg_temp.aliado('a1000000-0000-0000-0000-0000000000a1', 'Activa@Pub.test', '+573002220001', 'activo');
select pg_temp.aliado('a2000000-0000-0000-0000-0000000000a2', 'pendiente@pub.test', '+573002220002', 'pendiente');
select pg_temp.aliado('a3000000-0000-0000-0000-0000000000a3', 'rechazada@pub.test', '+573002220003', 'rechazado');
select pg_temp.aliado('a4000000-0000-0000-0000-0000000000a4', 'admin@pub.test', '+573002220004', 'activo');
update public.aliados set rol = 'admin' where id = 'a4000000-0000-0000-0000-0000000000a4';
select pg_temp.aliado('a5000000-0000-0000-0000-0000000000a5', 'suspendida@pub.test', '+573002220005', 'suspendido');

-- Estructura y privilegios --------------------------------------------------------------------------

select has_column('public', 'empresas', 'canal', 'empresas.canal existe');
select ok((select relrowsecurity from pg_class where oid = 'public.referidos_publicos_intentos'::regclass), 'RLS en referidos_publicos_intentos');
select ok((select relrowsecurity from pg_class where oid = 'public.referidos_publicos_permisos'::regclass), 'RLS en referidos_publicos_permisos');
select ok(not has_function_privilege('anon', 'public.registrar_oportunidad_publica(text, uuid, jsonb, jsonb)', 'execute'), 'anon no ejecuta registrar_oportunidad_publica');
select ok(not has_function_privilege('authenticated', 'public.registrar_oportunidad_publica(text, uuid, jsonb, jsonb)', 'execute'), 'authenticated no ejecuta registrar_oportunidad_publica');
select ok(not has_function_privilege('anon', 'public.referido_publico_intento(text, integer)', 'execute'), 'anon no ejecuta referido_publico_intento');
select ok(has_function_privilege('service_role', 'public.registrar_oportunidad_publica(text, uuid, jsonb, jsonb)', 'execute'), 'service_role sí la ejecuta');
select ok(not has_table_privilege('authenticated', 'public.referidos_publicos_intentos', 'select'), 'authenticated no lee los intentos');

-- Con sesión: sin cambios por fuera -------------------------------------------------------------------

select is(
  array(select k from jsonb_object_keys(public.registrar_oportunidad('a1000000-0000-0000-0000-0000000000a1',
    'e1000000-0000-0000-0000-0000000000e1', pg_temp.datos('uno@empresa.test'))) k order by 1),
  array['es_perfecto', 'movimientos', 'nivel', 'puntos_disponibles', 'puntos_nivel'],
  'Nueva oportunidad con sesión responde lo mismo que antes');
select is((select canal from public.empresas where id = 'e1000000-0000-0000-0000-0000000000e1'), 'sesion', 'con sesión queda canal = sesion');
insert into public.empresas (id, aliado_id, origen, empresa, sector, nombre_contacto, telefono, correo, valor_factura, es_perfecto, autorizacion_contacto_at)
values ('e9000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000a1', 'hub', 'E', 'Industrial', 'C', '+573100000000', 'sincanal@empresa.test', 1, false, now());
select is((select canal from public.empresas where id = 'e9000000-0000-0000-0000-0000000000e9'), 'sesion', 'una empresa del Hub sin canal queda como sesion (compatibilidad)');
select throws_ok(
  $$select public.registrar_oportunidad('a2000000-0000-0000-0000-0000000000a2', gen_random_uuid(), pg_temp.datos('dos@empresa.test'))$$,
  'P0001', null, 'con sesión una cuenta pendiente sigue sin poder registrar');

-- Público: aliado activo ------------------------------------------------------------------------------

select is(
  public.registrar_oportunidad_publica('  activa@PUB.test ', 'e2000000-0000-0000-0000-0000000000e2',
    pg_temp.datos('tres@empresa.test', '{"cargo": null}')),
  '{"es_perfecto": false, "puntos": 5}'::jsonb,
  'público: el correo se compara sin mayúsculas ni espacios; responde solo es_perfecto y los puntos del referido');
select row_eq(
  $$select aliado_id, origen, canal, es_perfecto, autorizacion_contacto_at is not null from public.empresas where id = 'e2000000-0000-0000-0000-0000000000e2'$$,
  row('a1000000-0000-0000-0000-0000000000a1'::uuid, 'hub'::text, 'publico'::text, false, true),
  'la empresa queda del aliado, origen hub y canal publico');
select is(
  (select array_agg(motivo order by secuencia) from public.movimientos_puntos where vinculo_id = 'e2000000-0000-0000-0000-0000000000e2'),
  array['registro_valido', 'referido_imperfecto'], '+10 y −5 en el libro del aliado');
select is((select perfecto::text from public.avance_empresa where empresa_id = 'e2000000-0000-0000-0000-0000000000e2'), 'no', 'avance con perfecto = no');
select ok(exists (select 1 from public.clientify_reclamar_empresas(5, 'e2000000-0000-0000-0000-0000000000e2')), 'entra a la cola del flujo B (Clientify)');

-- Público: factura con permiso ------------------------------------------------------------------------

select pg_temp.subir('publico/e3000000-0000-0000-0000-0000000000e3/factura.pdf');
select throws_ok(
  $$select public.registrar_oportunidad_publica('activa@pub.test', 'e3000000-0000-0000-0000-0000000000e3',
      pg_temp.datos('cuatro@empresa.test'), '{"storage_path": "publico/e3000000-0000-0000-0000-0000000000e3/factura.pdf"}')$$,
  'P0001', 'factura_invalida: el permiso para adjuntar la factura venció; vuelve a enviar el formulario',
  'con factura y sin permiso: rechazado');
select lives_ok($$select public.referido_publico_permiso('e3000000-0000-0000-0000-0000000000e3', pg_temp.huella(1))$$, 'el servidor crea el permiso');
select is(
  public.registrar_oportunidad_publica('activa@pub.test', 'e3000000-0000-0000-0000-0000000000e3',
    pg_temp.datos('cuatro@empresa.test'), '{"storage_path": "publico/e3000000-0000-0000-0000-0000000000e3/factura.pdf", "nombre_archivo": "f.pdf"}'),
  '{"es_perfecto": true, "puntos": 30}'::jsonb, 'con permiso y los 10 campos: referido perfecto, +30');
select ok((select usado_at is not null from public.referidos_publicos_permisos where empresa_id = 'e3000000-0000-0000-0000-0000000000e3'), 'el permiso queda usado');
select is((select storage_path from public.facturas where empresa_id = 'e3000000-0000-0000-0000-0000000000e3'),
  'publico/e3000000-0000-0000-0000-0000000000e3/factura.pdf', 'la factura queda registrada en la carpeta pública');

select pg_temp.subir('publico/e4000000-0000-0000-0000-0000000000e4/factura.pdf');
select public.referido_publico_permiso('e4000000-0000-0000-0000-0000000000e4', pg_temp.huella(1));
update public.referidos_publicos_permisos set vence_at = now() - interval '1 minute' where empresa_id = 'e4000000-0000-0000-0000-0000000000e4';
select throws_like(
  $$select public.registrar_oportunidad_publica('activa@pub.test', 'e4000000-0000-0000-0000-0000000000e4',
      pg_temp.datos('cinco@empresa.test'), '{"storage_path": "publico/e4000000-0000-0000-0000-0000000000e4/factura.pdf"}')$$,
  'factura_invalida:%', 'un permiso vencido no sirve');

select pg_temp.subir('a1000000-0000-0000-0000-0000000000a1/e5000000-0000-0000-0000-0000000000e5/factura.pdf');
select public.referido_publico_permiso('e5000000-0000-0000-0000-0000000000e5', pg_temp.huella(1));
select throws_ok(
  $$select public.registrar_oportunidad_publica('activa@pub.test', 'e5000000-0000-0000-0000-0000000000e5',
      pg_temp.datos('seis@empresa.test'), '{"storage_path": "a1000000-0000-0000-0000-0000000000a1/e5000000-0000-0000-0000-0000000000e5/factura.pdf"}')$$,
  'P0001', 'factura_invalida: la factura no pertenece a esta oportunidad', 'público: solo se acepta la carpeta publico/{empresa}');
select throws_like(
  $$select public.registrar_oportunidad_publica('activa@pub.test', 'e5000000-0000-0000-0000-0000000000e5',
      pg_temp.datos('seis@empresa.test'), '{"storage_path": "publico/e5000000-0000-0000-0000-0000000000e5/../x.pdf"}')$$,
  'factura_invalida:%', 'ni rutas con ".."');

-- Público: quién puede referir ----------------------------------------------------------------------------

select throws_ok($$select public.registrar_oportunidad_publica('nadie@pub.test', gen_random_uuid(), pg_temp.datos('siete@empresa.test'))$$,
  'P0001', 'referidor_invalido: el correo no corresponde a un aliado que pueda referir', 'correo inexistente: referidor_invalido');
select throws_like($$select public.registrar_oportunidad_publica('rechazada@pub.test', gen_random_uuid(), pg_temp.datos('siete@empresa.test'))$$,
  'referidor_invalido:%', 'aliado rechazado: referidor_invalido');
select throws_like($$select public.registrar_oportunidad_publica('admin@pub.test', gen_random_uuid(), pg_temp.datos('siete@empresa.test'))$$,
  'referidor_invalido:%', 'cuenta de admin: referidor_invalido');
select throws_like($$select public.registrar_oportunidad_publica(null, gen_random_uuid(), pg_temp.datos('siete@empresa.test'))$$,
  'referidor_invalido:%', 'sin correo: referidor_invalido');
select is((select count(*)::int from public.empresas where correo = 'siete@empresa.test'), 0, 'ninguno de esos dejó empresa');

select is(
  public.registrar_oportunidad_publica('pendiente@pub.test', 'e6000000-0000-0000-0000-0000000000e6', pg_temp.datos('ocho@empresa.test')),
  '{"es_perfecto": false, "puntos": 5}'::jsonb, 'aliado pendiente: se registra');
select is((select count(*)::int from public.movimientos_puntos where vinculo_id = 'e6000000-0000-0000-0000-0000000000e6'), 0, 'sus puntos no entran al libro…');
select is((select count(*)::int from public.movimientos_retenidos where vinculo_id = 'e6000000-0000-0000-0000-0000000000e6'), 2, '…quedan retenidos hasta que se active');
select lives_ok($$select public.registrar_oportunidad_publica('suspendida@pub.test', gen_random_uuid(), pg_temp.datos('nueve@empresa.test'))$$,
  'aliado suspendido: también se registra (puntos retenidos)');

-- Público: mismas reglas del Hub --------------------------------------------------------------------------

select throws_like($$select public.registrar_oportunidad_publica('activa@pub.test', gen_random_uuid(), pg_temp.datos('activa@pub.test'))$$,
  'autorreferido:%', 'autorreferido por correo');
select throws_like($$select public.registrar_oportunidad_publica('activa@pub.test', gen_random_uuid(), pg_temp.datos('diez@empresa.test', '{"telefono": "+573002220001"}'))$$,
  'autorreferido:%', 'autorreferido por celular');
select throws_like($$select public.registrar_oportunidad_publica('activa@pub.test', gen_random_uuid(), pg_temp.datos('tres@empresa.test'))$$,
  'referido_duplicado:%', 'contacto ya referido');
select throws_like($$select public.registrar_oportunidad_publica('activa@pub.test', gen_random_uuid(), pg_temp.datos('once@empresa.test', '{"autorizacion_contacto": false}'))$$,
  'oportunidad_invalida:%', 'sin la declaración Ley 1581');

-- Límite por conexión -----------------------------------------------------------------------------------

select is((select bool_and(public.referido_publico_intento(pg_temp.huella(7))) from generate_series(1, 10)), true, 'los primeros 10 intentos de una conexión pasan');
select is(public.referido_publico_intento(pg_temp.huella(7)), false, 'el intento 11 en la hora se frena');
select is(public.referido_publico_intento(pg_temp.huella(8)), true, 'otra conexión no se afecta');
update public.referidos_publicos_intentos set ventana_inicio = now() - interval '61 minutes' where huella = pg_temp.huella(7);
select is(public.referido_publico_intento(pg_temp.huella(7)), true, 'pasada la hora, la conexión vuelve a poder enviar');
select is((select intentos from public.referidos_publicos_intentos where huella = pg_temp.huella(7)), 1, 'y su contador se reinicia');
select throws_like($$select public.referido_publico_intento('1.2.3.4')$$, 'dato_invalido:%', 'nunca se guarda una IP: solo huellas');

select * from finish();
rollback;
