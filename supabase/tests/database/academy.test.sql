-- Tests de la Academy administrable (CLAUDE.md §4.9): catálogo para el Hub (con y sin cuenta activa), escrituras del
-- panel con sus validaciones, Puntos Sol de los minicursos nuevos, cursos anteriores desactivados y permisos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

create function pg_temp.aliado(id uuid, email text, celular text)
returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Aliada Academy', 'celular', celular, 'tipo_aliado', 'emi',
    'como_llega_empresas', 'Red', 'autorizacion_datos', true, 'acepta_terminos', true));
$$;
create function pg_temp.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.contenido() returns jsonb language sql as $$
  select '{"aprenderas":["Una idea"],"contexto":"Por qué importa.","lecciones":[{"titulo":"Lección 1","texto":"Texto de la lección."}],
           "ejercicio":"Hazlo.","pasos":["Paso 1"],"quiz":[{"pregunta":"¿Sí?","opciones":["No","Sí","Tal vez"],"correcta":1}],
           "accion":"Aplícalo esta semana."}'::jsonb;
$$;
create function pg_temp.curso(codigo text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('nuevo', true, 'codigo', codigo, 'titulo', 'Curso ' || codigo, 'descripcion', 'Corto.',
    'escuela', 'ia', 'formato', 'flash', 'minutos', 5, 'nivel', 'Principiante', 'aliados', '["todos"]'::jsonb,
    'acceso', 'aliado', 'puntos', 5, 'herramienta', 't-prueba-tap', 'contenido', pg_temp.contenido()) || extra;
$$;

select pg_temp.aliado('ac000000-0000-0000-0000-00000000000a', 'z@academy.test', '+573004440001');
select pg_temp.aliado('ac000000-0000-0000-0000-000000000001', 'a@academy.test', '+573004440002');
select pg_temp.aliado('ac000000-0000-0000-0000-000000000002', 'p@academy.test', '+573004440003');
update public.aliados set estado = 'activo', rol = 'admin' where id = 'ac000000-0000-0000-0000-00000000000a';
update public.aliados set estado = 'activo' where id = 'ac000000-0000-0000-0000-000000000001';
insert into public.academy_herramientas (codigo, nombre, categoria, icono, descripcion, acceso)
values ('t-prueba-tap', 'Herramienta de prueba', 'Pruebas', 'book', 'Material de prueba.', 'free');

-- Cursos anteriores
select ok(not exists (select 1 from public.modulos where escuela is null and activo),
  'los cursos de la Academy anterior quedan desactivados');

-- Panel: crear un curso ------------------------------------------------------------------------------------------
select is(public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a',
  pg_temp.curso('tap-curso-solo-aliados-con-un-codigo-bastante-largo-para-probar')) ->> 'nuevo', 'true',
  'el admin crea un minicurso (código largo, como los títulos de la Academy)');
select is(public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a',
  pg_temp.curso('tap-curso-gratis', '{"acceso":"free","puntos":0}')) ->> 'codigo', 'tap-curso-gratis', 'y uno gratis sin puntos');
select row_eq($$select puntos, activo, nuevo, escuela from public.modulos where codigo = 'tap-curso-gratis'$$,
  row(0, true, true, 'ia'::text), 'queda activo, con la etiqueta «nuevo» y sus datos');
select throws_ok($$select public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a', pg_temp.curso('tap-curso-gratis'))$$,
  'P0001', 'estado_invalido: ya existe un curso con ese código', 'no se duplica un código');
select throws_ok($$select public.admin_guardar_curso('ac000000-0000-0000-0000-000000000001', pg_temp.curso('tap-otro'))$$,
  'P0001', 'no_autorizado: se requiere una cuenta de administrador activa', 'un aliado no edita la Academy');
select throws_like($$select public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a', pg_temp.curso('tap-otro', '{"puntos":7}'))$$,
  'dato_invalido: los Puntos Sol%', 'un curso da 5, 10 (masterclass) o 0 Puntos Sol');
select throws_like($$select public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a', pg_temp.curso('tap-otro', '{"herramienta":"t-no-existe"}'))$$,
  'dato_invalido: elige la herramienta%', 'la herramienta del paso Descarga debe existir');
select throws_like($$select public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a',
  pg_temp.curso('tap-otro', jsonb_build_object('contenido', jsonb_set(pg_temp.contenido(), '{quiz,0,correcta}', '3'))))$$,
  'dato_invalido: cada pregunta%', 'la respuesta correcta debe ser una de las opciones');
select throws_like($$select public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a',
  pg_temp.curso('tap-otro', jsonb_build_object('contenido', pg_temp.contenido() - 'lecciones')))$$,
  'dato_invalido: «Aprende»%', 'cada curso necesita sus microlecciones');
select throws_like($$select public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a', pg_temp.curso('Tap Mayus'))$$,
  'dato_invalido: el código%', 'el código usa minúsculas y guiones');

-- Panel: editar ----------------------------------------------------------------------------------------------------
select public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a',
  pg_temp.curso('tap-curso-gratis', jsonb_build_object('nuevo', false, 'titulo', 'Título nuevo', 'activo', false,
    'contenido', jsonb_set(pg_temp.contenido(), '{contexto}', '"Contexto editado."'))));
select row_eq($$select m.nombre, m.activo, c.contenido ->> 'contexto' from public.modulos m join public.modulos_contenido c on c.modulo_id = m.id
                where m.codigo = 'tap-curso-gratis'$$,
  row('Título nuevo'::text, false, 'Contexto editado.'::text), 'se edita y se puede ocultar un curso');
select throws_like($$select public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a', pg_temp.curso('c11', '{"nuevo":false}'))$$,
  'no_permitido:%', 'los cursos de la Academy anterior no se editan');
select is((select count(*)::integer from public.acciones_admin where accion = 'guardar_curso' and objetivo like 'curso:tap-%'), 3,
  'cada guardado queda en la auditoría');

-- Catálogo para el Hub ------------------------------------------------------------------------------------------------
select public.admin_guardar_curso('ac000000-0000-0000-0000-00000000000a',
  pg_temp.curso('tap-curso-gratis', jsonb_build_object('nuevo', false, 'activo', true, 'acceso', 'free', 'puntos', 0,
    'contenido', jsonb_set(pg_temp.contenido(), '{contexto}', '"Contexto editado."'))));
set local role anon;
select pg_temp.como(null);
create temp table cat_anon as select public.academy_catalogo() c;
reset role;
select is((select x -> 'contenido' ->> 'contexto' from cat_anon, jsonb_array_elements(c -> 'cursos') x where x ->> 'codigo' = 'tap-curso-gratis'),
  'Contexto editado.', 'sin sesión se ve todo el contenido de un curso gratis');
select row_eq($$select x -> 'contenido' ? 'contexto', x -> 'contenido' -> 'lecciones' -> 0 ->> 'titulo', (x ->> 'completo')::boolean
                from cat_anon, jsonb_array_elements(c -> 'cursos') x where x ->> 'codigo' = 'tap-curso-solo-aliados-con-un-codigo-bastante-largo-para-probar'$$,
  row(false, 'Lección 1'::text, false), 'de un curso solo para aliados solo llega el temario');
select ok(not exists (select 1 from cat_anon, jsonb_array_elements(c -> 'cursos') x where x ->> 'codigo' = 'c11'),
  'el catálogo no trae los cursos anteriores');
select ok(exists (select 1 from cat_anon, jsonb_array_elements(c -> 'herramientas') x where x ->> 'codigo' = 't-prueba-tap'),
  'trae las herramientas activas');

set local role authenticated;
select pg_temp.como('ac000000-0000-0000-0000-000000000001');
select is((select x -> 'contenido' ->> 'ejercicio' from jsonb_array_elements(public.academy_catalogo() -> 'cursos') x
           where x ->> 'codigo' = 'tap-curso-solo-aliados-con-un-codigo-bastante-largo-para-probar'), 'Hazlo.',
  'un aliado activo ve el contenido completo');
select ok((select count(*) from public.modulos_contenido) = 0 and (select count(*) from public.v_admin_academy_cursos) = 0,
  'un aliado no lee el contenido directo de la tabla ni las vistas del panel');
select pg_temp.como('ac000000-0000-0000-0000-000000000002');
select ok(not (select (x ->> 'completo')::boolean from jsonb_array_elements(public.academy_catalogo() -> 'cursos') x
               where x ->> 'codigo' = 'tap-curso-solo-aliados-con-un-codigo-bastante-largo-para-probar'),
  'una cuenta pendiente tampoco ve el contenido de los cursos de aliados');
select pg_temp.como('ac000000-0000-0000-0000-00000000000a');
select ok((select count(*) from public.v_admin_academy_cursos where codigo like 'tap-%') = 2, 'el admin ve los cursos en el panel');
reset role;

-- Puntos Sol del minicurso nuevo: +5, la regla de siempre --------------------------------------------------------
select is(public.completar_modulo('ac000000-0000-0000-0000-000000000001', 'tap-curso-solo-aliados-con-un-codigo-bastante-largo-para-probar') ->> 'recompensa_estado',
  'otorgada', 'completar un minicurso nuevo otorga sus Puntos Sol');
select is((select puntos_aplicados from public.movimientos_puntos m join public.modulos_completados mc on m.vinculo_id = mc.id::text
           where mc.aliado_id = 'ac000000-0000-0000-0000-000000000001' and m.motivo = 'modulo_completado'), 5, '+5');

-- Certificaciones y herramientas ---------------------------------------------------------------------------------
select is(public.admin_guardar_certificacion('ac000000-0000-0000-0000-00000000000a', jsonb_build_object('nuevo', true, 'codigo', 'tap-cert',
  'nombre', 'Certificación de prueba', 'descripcion', 'Prueba.', 'escuela', 'ia', 'sigla', 'TP',
  'cursos', '["tap-curso-gratis","tap-curso-solo-aliados-con-un-codigo-bastante-largo-para-probar","tap-curso-gratis"]'::jsonb)) ->> 'nuevo', 'true',
  'el admin crea una certificación con sus minicursos');
select is((select cursos from public.academy_certificaciones where codigo = 'tap-cert'),
  array['tap-curso-gratis', 'tap-curso-solo-aliados-con-un-codigo-bastante-largo-para-probar'], 'en orden y sin repetidos');
select throws_like($$select public.admin_guardar_certificacion('ac000000-0000-0000-0000-00000000000a', jsonb_build_object('nuevo', true, 'codigo', 'tap-cert2',
  'nombre', 'Otra', 'descripcion', 'Prueba.', 'escuela', 'ia', 'sigla', 'TP', 'cursos', '["no-existe"]'::jsonb))$$,
  'dato_invalido: el minicurso%', 'solo con minicursos que existen');
select throws_like($$select public.admin_guardar_herramienta('ac000000-0000-0000-0000-00000000000a', jsonb_build_object('nuevo', true, 'codigo', 't-nueva',
  'nombre', 'Nueva', 'categoria', 'IA', 'icono', 'ia', 'descripcion', 'Prueba.', 'acceso', 'aliado'))$$,
  'dato_invalido: sube el archivo%', 'una herramienta nueva necesita su archivo');
select throws_like($$select public.admin_guardar_herramienta('ac000000-0000-0000-0000-00000000000a', jsonb_build_object('nuevo', true, 'codigo', 't-nueva',
  'nombre', 'Nueva', 'categoria', 'IA', 'icono', 'ia', 'descripcion', 'Prueba.', 'acceso', 'aliado',
  'archivo_path', 'herramientas/00000000-0000-0000-0000-000000000000.pdf', 'archivo_nombre', 'x.pdf'))$$,
  'dato_invalido: el archivo no se subió', 'y el archivo debe estar en el bucket');

-- Certificación completa: +15, aparte de los minicursos y por fuera del tope mensual --------------------------------
select public.completar_modulo('ac000000-0000-0000-0000-000000000001', 'tap-curso-gratis');
select row_eq($$select count(*)::integer, sum(puntos_aplicados)::integer, min(vinculo), min(nota) from public.movimientos_puntos
                where aliado_id = 'ac000000-0000-0000-0000-000000000001' and motivo = 'certificacion_academy'$$,
  row(1, 15, 'academy_certificaciones'::text, 'Certificación: Certificación de prueba'::text),
  'al completar el último minicurso de la certificación gana +15');
select public.admin_guardar_certificacion('ac000000-0000-0000-0000-00000000000a', jsonb_build_object('codigo', 'tap-cert',
  'nombre', 'Certificación de prueba', 'descripcion', 'Prueba editada.', 'escuela', 'ia', 'sigla', 'TP',
  'cursos', '["tap-curso-gratis","tap-curso-solo-aliados-con-un-codigo-bastante-largo-para-probar"]'::jsonb));
select is(interno.otorgar_certificaciones('ac000000-0000-0000-0000-000000000001') + (select count(*)::integer from public.movimientos_puntos
  where aliado_id = 'ac000000-0000-0000-0000-000000000001' and motivo = 'certificacion_academy'), 1,
  'una sola vez por certificación, aunque se edite o se vuelva a revisar');
select public.admin_guardar_certificacion('ac000000-0000-0000-0000-00000000000a', jsonb_build_object('nuevo', true, 'codigo', 'tap-cert3',
  'nombre', 'Otra certificación', 'descripcion', 'Prueba.', 'escuela', 'ia', 'sigla', 'T3',
  'cursos', '["tap-curso-solo-aliados-con-un-codigo-bastante-largo-para-probar"]'::jsonb));
select is((select count(*)::integer from public.movimientos_puntos
  where aliado_id = 'ac000000-0000-0000-0000-000000000001' and motivo = 'certificacion_academy'), 2,
  'una certificación nueva da los +15 a quien ya completó sus minicursos');
select ok(exists (select 1 from public.modulos where escuela is not null and formato = 'masterclass')
      and not exists (select 1 from public.modulos where escuela is not null and formato = 'masterclass' and puntos <> 10),
  'la masterclass da +10');

-- Integridad del catálogo cargado --------------------------------------------------------------------------------
select lives_ok($$select interno.validar_contenido_curso(contenido) from public.modulos_contenido$$,
  'todo el contenido cargado cumple la estructura de 6 pasos');
select ok(not exists (select 1 from public.modulos m where m.escuela is not null
                      and not exists (select 1 from public.academy_herramientas h where h.codigo = m.herramienta))
      and not exists (select 1 from public.academy_certificaciones c, unnest(c.cursos) x
                      where not exists (select 1 from public.modulos m where m.codigo = x)),
  'cada curso tiene su herramienta y cada certificación sus cursos');

select * from finish();
rollback;
