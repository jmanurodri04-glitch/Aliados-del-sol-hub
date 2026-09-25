-- Tests de calcular_nivel (CLAUDE.md §6.3): cada límite de puntos y de calidad.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Bronce / Plata: 100 pts y 50 %
select is(public.calcular_nivel(0, null),     'bronce'::public.nivel, 'sin puntos ni calidad → bronce');
select is(public.calcular_nivel(0, 100),      'bronce'::public.nivel, '0 pts con 100 % → bronce');
select is(public.calcular_nivel(99, 100),     'bronce'::public.nivel, '99 pts con 100 % → bronce');
select is(public.calcular_nivel(100, 50),     'plata'::public.nivel,  '100 pts con 50 % → plata');
select is(public.calcular_nivel(100, 49.99),  'bronce'::public.nivel, '100 pts con 49.99 % → bronce');

-- Oro: 250 pts y 60 %
select is(public.calcular_nivel(249, 60),     'plata'::public.nivel,  '249 pts con 60 % → plata');
select is(public.calcular_nivel(250, 60),     'oro'::public.nivel,    '250 pts con 60 % → oro');
select is(public.calcular_nivel(250, 59.99),  'plata'::public.nivel,  '250 pts con 59.99 % → plata');

-- Platino: 450 pts y 70 %
select is(public.calcular_nivel(449, 70),     'oro'::public.nivel,     '449 pts con 70 % → oro');
select is(public.calcular_nivel(450, 70),     'platino'::public.nivel, '450 pts con 70 % → platino');
select is(public.calcular_nivel(450, 69.99),  'oro'::public.nivel,     '450 pts con 69.99 % → oro');

-- Diamante: 700 pts y 80 %
select is(public.calcular_nivel(699, 80),     'platino'::public.nivel,  '699 pts con 80 % → platino');
select is(public.calcular_nivel(700, 80),     'diamante'::public.nivel, '700 pts con 80 % → diamante');
select is(public.calcular_nivel(700, 79.99),  'platino'::public.nivel,  '700 pts con 79.99 % → platino');

-- Círculo Solar: 1000 pts y 85 %
select is(public.calcular_nivel(999, 85),     'diamante'::public.nivel,      '999 pts con 85 % → diamante');
select is(public.calcular_nivel(1000, 85),    'circulo_solar'::public.nivel, '1000 pts con 85 % → círculo solar');
select is(public.calcular_nivel(1000, 84.99), 'diamante'::public.nivel,      '1000 pts con 84.99 % → diamante');
select is(public.calcular_nivel(50000, 100),  'circulo_solar'::public.nivel, 'muchos puntos con 100 % → círculo solar');

-- Deben cumplirse puntos Y calidad; se asigna el primer nivel que cumpla ambas
select is(public.calcular_nivel(1000, 60),    'oro'::public.nivel,    'ejemplo del CLAUDE.md: 1000 pts con 60 % → oro');
select is(public.calcular_nivel(1000, 50),    'plata'::public.nivel,  '1000 pts con 50 % → plata');
select is(public.calcular_nivel(1000, 49.99), 'bronce'::public.nivel, '1000 pts con 49.99 % → bronce');
select is(public.calcular_nivel(1000, null),  'bronce'::public.nivel, 'calidad NULL cuenta como 0 → bronce');
select is(public.calcular_nivel(120, 95),     'plata'::public.nivel,  'calidad alta con pocos puntos → plata');
select is(public.calcular_nivel(99, 99.99),   'bronce'::public.nivel, 'calidad alta con 99 pts → bronce');
select is(public.calcular_nivel(null, 100),   'bronce'::public.nivel, 'puntos NULL → bronce');

-- Propiedades de la función
select volatility_is('public', 'calcular_nivel', array['integer', 'numeric'], 'immutable', 'calcular_nivel es inmutable (pura)');
select function_returns('public', 'calcular_nivel', array['integer', 'numeric'], 'nivel', 'calcular_nivel devuelve el enum nivel');
select ok(
  not exists (
    select 1 from generate_series(0, 1200, 10) p, generate_series(0, 100, 5) c
    where public.calcular_nivel(p, c) is null
  ),
  'ningún aliado queda sin nivel'
);
select ok(
  not exists (
    select 1 from generate_series(0, 1190, 10) p, generate_series(0, 100, 5) c
    where public.calcular_nivel(p + 10, c) < public.calcular_nivel(p, c)
       or public.calcular_nivel(p, least(c + 5, 100)) < public.calcular_nivel(p, c)
  ),
  'el nivel nunca baja al subir puntos o calidad'
);

select * from finish();
rollback;
