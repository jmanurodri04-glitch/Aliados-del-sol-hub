-- Tests de la imagen de las recompensas (CLAUDE.md §4.10): bucket público, formato y existencia del archivo, conservar,
-- cambiar o quitar la imagen y las vistas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create function pg_temp.aliado(id uuid, email text)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Prueba Imagen', 'celular', '+5730' || lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0'), 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
$$;
create function pg_temp.subir(nombre text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata) values ('recompensas', nombre, '{"mimetype":"image/png","size":1000}');
$$;
create function pg_temp.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- Z: admin · A: aliado activo
select pg_temp.aliado('a1000000-0000-0000-0000-00000000000a', 'z@imagen.test');
select pg_temp.aliado('a1000000-0000-0000-0000-000000000001', 'a@imagen.test');
update public.aliados set estado = 'activo', rol = 'admin' where id = 'a1000000-0000-0000-0000-00000000000a';
update public.aliados set estado = 'activo' where id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.subir('11111111-1111-1111-1111-111111111111.png');
select pg_temp.subir('22222222-2222-2222-2222-222222222222.webp');

select ok((select public and file_size_limit = 2097152 and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
           from storage.buckets where id = 'recompensas'),
  'el bucket recompensas es público, de 2 MB y solo acepta JPG, PNG o WebP');

select throws_ok($$select public.admin_guardar_recompensa('a1000000-0000-0000-0000-00000000000a', null,
  '{"codigo":"img-a","nombre":"Con imagen","puntos":10,"imagen_path":"../otro/archivo.png"}')$$,
  'P0001', 'dato_invalido: la imagen no es válida', 'el nombre del archivo tiene un formato fijo');
select throws_ok($$select public.admin_guardar_recompensa('a1000000-0000-0000-0000-00000000000a', null,
  '{"codigo":"img-a","nombre":"Con imagen","puntos":10,"imagen_path":"33333333-3333-3333-3333-333333333333.png"}')$$,
  'P0001', 'dato_invalido: la imagen no se subió; vuelve a elegirla', 'la imagen debe existir en el bucket');

select is(public.admin_guardar_recompensa('a1000000-0000-0000-0000-00000000000a', null,
  '{"codigo":"img-a","nombre":"Con imagen","puntos":10,"imagen_path":"11111111-1111-1111-1111-111111111111.png"}') ->> 'imagen_path',
  '11111111-1111-1111-1111-111111111111.png', 'se crea una recompensa con imagen');
select is(public.admin_guardar_recompensa('a1000000-0000-0000-0000-00000000000a', null,
  '{"codigo":"img-b","nombre":"Sin imagen","puntos":10}') ->> 'imagen_path', null, 'la imagen es opcional');

select is(public.admin_guardar_recompensa('a1000000-0000-0000-0000-00000000000a', (select id from public.recompensas where codigo = 'img-a'),
  '{"nombre":"Con imagen editada","puntos":12}') - 'recompensa_id',
  '{"codigo":"img-a","activa":true,"imagen_path":"11111111-1111-1111-1111-111111111111.png","imagen_anterior":null}'::jsonb,
  'editar sin enviar la imagen la conserva');

select is(public.admin_guardar_recompensa('a1000000-0000-0000-0000-00000000000a', (select id from public.recompensas where codigo = 'img-a'),
  '{"nombre":"Con imagen editada","puntos":12,"imagen_path":"22222222-2222-2222-2222-222222222222.webp"}') ->> 'imagen_anterior',
  '11111111-1111-1111-1111-111111111111.png', 'cambiar la imagen devuelve la anterior para borrarla');
select is((select imagen_path from public.recompensas where codigo = 'img-a'), '22222222-2222-2222-2222-222222222222.webp',
  'queda la imagen nueva');

select is(public.admin_guardar_recompensa('a1000000-0000-0000-0000-00000000000a', (select id from public.recompensas where codigo = 'img-a'),
  '{"nombre":"Con imagen editada","puntos":12,"imagen_path":"22222222-2222-2222-2222-222222222222.webp"}') ->> 'imagen_anterior',
  null, 'guardar la misma imagen no devuelve nada para borrar');

select is((select count(*)::integer from public.acciones_admin
           where accion = 'guardar_recompensa' and objetivo = 'recompensa:img-a'
             and detalle -> 'antes' ->> 'imagen' = '11111111-1111-1111-1111-111111111111.png'
             and detalle ->> 'imagen' = '22222222-2222-2222-2222-222222222222.webp'),
  1, 'el cambio de imagen queda auditado');

select is(public.admin_guardar_recompensa('a1000000-0000-0000-0000-00000000000a', (select id from public.recompensas where codigo = 'img-a'),
  '{"nombre":"Con imagen editada","puntos":12,"imagen_path":""}') ->> 'imagen_anterior',
  '22222222-2222-2222-2222-222222222222.webp', 'enviar la imagen vacía la quita');
select is((select imagen_path from public.recompensas where codigo = 'img-a'), null, 'la recompensa queda sin imagen');

select public.admin_guardar_recompensa('a1000000-0000-0000-0000-00000000000a', (select id from public.recompensas where codigo = 'img-b'),
  '{"nombre":"Sin imagen","puntos":10,"imagen_path":"11111111-1111-1111-1111-111111111111.png"}');

set local role authenticated;
select pg_temp.como('a1000000-0000-0000-0000-000000000001');
select is((select imagen_path from public.v_recompensas where codigo = 'img-b'), '11111111-1111-1111-1111-111111111111.png',
  'el aliado ve la imagen en el catálogo');
select pg_temp.como('a1000000-0000-0000-0000-00000000000a');
select is((select imagen_path from public.v_admin_recompensas where codigo = 'img-b'), '11111111-1111-1111-1111-111111111111.png',
  'el panel ve la imagen');
reset role;

select * from finish();
rollback;
