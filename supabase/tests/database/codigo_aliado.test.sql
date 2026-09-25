-- Tests de generación de codigo_aliado (CLAUDE.md §2).
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Prefijo por tipo
select is(public.prefijo_tipo_aliado('financiero'),        'FI', 'financiero → FI');
select is(public.prefijo_tipo_aliado('emi'),               'EM', 'emi → EM');
select is(public.prefijo_tipo_aliado('linker'),            'LK', 'linker → LK');
select is(public.prefijo_tipo_aliado('cliente_embajador'), 'CE', 'cliente_embajador → CE');
select is(public.prefijo_tipo_aliado('agremiaciones'),     'AG', 'agremiaciones → AG');

-- Iniciales
select is(public.iniciales_nombre('Juan José Pérez León'),        'JJPL', 'ejemplo del CLAUDE.md');
select is(public.iniciales_nombre('Úrsula Ñáñez Güiza'),          'UNG',  'quita tildes, Ñ → N y Ü → U');
select is(public.iniciales_nombre('ángel ñustes'),                'AN',   'minúsculas con tilde → mayúsculas sin tilde');
select is(public.iniciales_nombre('María de los Ángeles Núñez'),  'MAN',  'ignora las partículas de, los');
select is(public.iniciales_nombre('Ana Del Río y La Torre'),      'ART',  'partículas sin importar mayúsculas: Del, y, La');
select is(public.iniciales_nombre('Pedro Las Casas Los Álamos'),  'PCA',  'ignora las, los');
select is(public.iniciales_nombre('Ana Beatriz Carolina Diana Elena'), 'ABCD', 'máximo 4 iniciales');
select is(public.iniciales_nombre('  pedro    pablo  '),          'PP',   'espacios repetidos y en los extremos');
select is(public.iniciales_nombre('Ana-María Ruiz'),              'AMR',  'el guion separa palabras');
select is(public.iniciales_nombre('O''Neil 3ro Smith'),           'ORS',  'ignora signos y dígitos dentro de cada palabra');
select is(public.iniciales_nombre(''),                            'X',    'nombre vacío → X');
select is(public.iniciales_nombre('de la y'),                     'X',    'solo partículas → X');

-- Aleatorio
select is(
  (select count(*) from generate_series(1, 2000)
   where public.aleatorio_codigo(8) !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  0::bigint,
  '2000 aleatorios: 8 caracteres del alfabeto permitido'
);
select is(
  (select count(distinct ch)
   from generate_series(1, 1000) as g,
        regexp_split_to_table(public.aleatorio_codigo(8 + 0 * g), '') as ch),
  31::bigint,
  'en 8000 caracteres aparecen los 31 del alfabeto'
);
select is(
  (select count(*)
   from generate_series(1, 1000) as g,
        regexp_split_to_table(public.aleatorio_codigo(8 + 0 * g), '') as ch
   where ch in ('0', 'O', '1', 'I', 'L')),
  0::bigint,
  'nunca aparecen 0 O 1 I L'
);
select is(length(public.aleatorio_codigo(12)), 12, 'respeta la longitud pedida');
select throws_ok('select public.aleatorio_codigo(0)', 'P0001', 'longitud debe ser >= 1', 'longitud inválida');

-- Código completo
select matches(
  public.generar_codigo_aliado('Juan José Pérez León', 'financiero'),
  '^FIJJPL[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$',
  'Juan José Pérez León (financiero) → FIJJPL + 8'
);
select matches(
  public.generar_codigo_aliado('María de los Ángeles Núñez', 'cliente_embajador'),
  '^CEMAN[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$',
  'María de los Ángeles Núñez (cliente_embajador) → CEMAN + 8'
);
select is(
  (select count(distinct public.generar_codigo_aliado('Juan Pérez', 'emi')) from generate_series(1, 1000)),
  1000::bigint,
  '1000 códigos generados, todos distintos'
);
select throws_ok(
  $$select public.generar_codigo_aliado('Juan Pérez', null)$$,
  'P0001', 'tipo_aliado es obligatorio para generar el código',
  'exige el tipo de aliado'
);
select ok(
  (select bool_and(
     public.generar_codigo_aliado(n, t) ~ '^(FI|EM|LK|CE|AG)[A-Z]{1,4}[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$')
   from unnest(array['Juan José Pérez León', '', 'de la y', 'Ana Beatriz Carolina Diana Elena']) n,
        unnest(enum_range(null::public.tipo_aliado)) t),
  'todo código generado cumple el CHECK de formato de aliados'
);

-- Permisos: solo el servidor genera códigos
select ok(
  not has_function_privilege('authenticated', 'public.generar_codigo_aliado(text, public.tipo_aliado)', 'execute')
  and not has_function_privilege('anon', 'public.generar_codigo_aliado(text, public.tipo_aliado)', 'execute'),
  'anon y authenticated no pueden generar códigos'
);

select * from finish();
rollback;
