-- Tests de calcular_nivel (CLAUDE.md §6.3): niveles KILO, MEGA, GIGA, TERA, PETA y EXA. Cada límite de puntos y de
-- calidad, y el requisito de cotización (un referido en «Presentación de oferta» o después) de GIGA en adelante.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- KILO / MEGA: 480 pts y 50 % (MEGA no exige cotización)
select is(public.calcular_nivel(0, null, false),   'kilo'::public.nivel, 'sin puntos ni calidad → kilo');
select is(public.calcular_nivel(0, 100, true),     'kilo'::public.nivel, '0 pts con 100 % y cotización → kilo');
select is(public.calcular_nivel(479, 100, true),   'kilo'::public.nivel, '479 pts → kilo');
select is(public.calcular_nivel(480, 50, false),   'mega'::public.nivel, '480 pts con 50 % sin cotización → mega');
select is(public.calcular_nivel(480, 49.99, true), 'kilo'::public.nivel, '480 pts con 49.99 % → kilo');

-- MEGA / GIGA: 960 pts, 60 % y cotización
select is(public.calcular_nivel(959, 100, true),   'mega'::public.nivel, '959 pts → mega');
select is(public.calcular_nivel(960, 60, true),    'giga'::public.nivel, '960 pts con 60 % y cotización → giga');
select is(public.calcular_nivel(960, 59.99, true), 'mega'::public.nivel, '960 pts con 59.99 % → mega');
select is(public.calcular_nivel(960, 100, false),  'mega'::public.nivel, '960 pts con 100 % sin cotización → mega');

-- GIGA / TERA: 1440 pts y 70 %
select is(public.calcular_nivel(1439, 100, true),  'giga'::public.nivel, '1439 pts → giga');
select is(public.calcular_nivel(1440, 70, true),   'tera'::public.nivel, '1440 pts con 70 % → tera');
select is(public.calcular_nivel(1440, 69.99, true),'giga'::public.nivel, '1440 pts con 69.99 % → giga');

-- TERA / PETA: 1920 pts y 80 %
select is(public.calcular_nivel(1919, 100, true),  'tera'::public.nivel, '1919 pts → tera');
select is(public.calcular_nivel(1920, 80, true),   'peta'::public.nivel, '1920 pts con 80 % → peta');
select is(public.calcular_nivel(1920, 79.99, true),'tera'::public.nivel, '1920 pts con 79.99 % → tera');

-- PETA / EXA: 2400 pts y 85 %
select is(public.calcular_nivel(2399, 100, true),  'peta'::public.nivel, '2399 pts → peta');
select is(public.calcular_nivel(2400, 85, true),   'exa'::public.nivel,  '2400 pts con 85 % → exa');
select is(public.calcular_nivel(2400, 84.99, true),'peta'::public.nivel, '2400 pts con 84.99 % → peta');
select is(public.calcular_nivel(50000, 100, true), 'exa'::public.nivel,  'muchos puntos con 100 % → exa');

-- La cotización y la calidad pueden bajar el nivel que darían los puntos (nadie queda por fuera)
select is(public.calcular_nivel(2000, 100, false), 'mega'::public.nivel, '2000 pts y 100 % sin cotización → mega');
select is(public.calcular_nivel(2000, 55, true),   'mega'::public.nivel, '2000 pts con cotización y 55 % → mega (manda la calidad)');
select is(public.calcular_nivel(2000, 65, true),   'giga'::public.nivel, '2000 pts con cotización y 65 % → giga');
select is(public.calcular_nivel(2000, 49.99, true),'kilo'::public.nivel, '2000 pts con cotización y 49.99 % → kilo');
select is(public.calcular_nivel(2000, null, true), 'kilo'::public.nivel, 'calidad NULL cuenta como 0 → kilo');
select is(public.calcular_nivel(500, 95, true),    'mega'::public.nivel, 'calidad alta con pocos puntos → mega');
select is(public.calcular_nivel(null, 100, true),  'kilo'::public.nivel, 'puntos NULL → kilo');
select is(public.calcular_nivel(3000, 100, null),  'mega'::public.nivel, 'cotización NULL cuenta como no tener → mega');

-- La versión de dos argumentos equivale a «sin cotización»
select is(public.calcular_nivel(3000, 100),        'mega'::public.nivel, 'calcular_nivel(puntos, calidad) nunca pasa de mega');

-- El orden del enum se conserva (lo usa el canje: nivel actual ≥ nivel mínimo)
select ok('kilo'::public.nivel < 'mega' and 'mega'::public.nivel < 'giga' and 'giga'::public.nivel < 'tera'
      and 'tera'::public.nivel < 'peta' and 'peta'::public.nivel < 'exa', 'los niveles van de KILO a EXA en orden');

-- Propiedades de la función
select volatility_is('public', 'calcular_nivel', array['integer', 'numeric', 'boolean'], 'immutable', 'calcular_nivel es inmutable (pura)');
select function_returns('public', 'calcular_nivel', array['integer', 'numeric', 'boolean'], 'nivel', 'calcular_nivel devuelve el enum nivel');
select ok(
  not exists (
    select 1 from generate_series(0, 3000, 20) p, generate_series(0, 100, 5) c, (values (true), (false)) t(k)
    where public.calcular_nivel(p, c, k) is null
  ),
  'ningún aliado queda sin nivel'
);
select ok(
  not exists (
    select 1 from generate_series(0, 2980, 20) p, generate_series(0, 100, 5) c, (values (true), (false)) t(k)
    where public.calcular_nivel(p + 20, c, k) < public.calcular_nivel(p, c, k)
       or public.calcular_nivel(p, least(c + 5, 100), k) < public.calcular_nivel(p, c, k)
       or public.calcular_nivel(p, c, true) < public.calcular_nivel(p, c, k)
  ),
  'el nivel nunca baja al subir puntos, calidad o al tener cotización'
);

-- El nivel es el menor entre el nivel por puntos, el nivel por calidad y el tope sin cotización (MEGA)
select ok(
  not exists (
    select 1 from generate_series(0, 3000, 20) p, generate_series(0, 100, 5) c, (values (true), (false)) t(k)
    where public.calcular_nivel(p, c, k)
       <> least(public.calcular_nivel(p, 100, true), public.calcular_nivel(1000000, c, true),
                case when k then 'exa'::public.nivel else 'mega'::public.nivel end)
  ),
  'el nivel es el menor entre puntos, calidad y cotización'
);
select ok(
  not exists (
    select 1 from generate_series(0, 3000, 20) p, generate_series(0, 100, 5) c
    where public.calcular_nivel(p, c, false) > 'mega'
  ),
  'sin cotización nadie pasa de MEGA'
);
select ok(has_function_privilege('authenticated', 'public.calcular_nivel(integer, numeric, boolean)', 'execute')
      and not has_function_privilege('anon', 'public.calcular_nivel(integer, numeric, boolean)', 'execute'),
  'calcular_nivel la puede usar el Hub con sesión, no anon');
select ok(not has_function_privilege('authenticated', 'interno.tiene_cotizacion(uuid)', 'execute'),
  'tiene_cotizacion es interna');
select is(enum_range(null::public.nivel)::text[], array['kilo', 'mega', 'giga', 'tera', 'peta', 'exa'],
  'el enum nivel tiene los seis niveles nuevos');

select * from finish();
rollback;
