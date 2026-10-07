-- Tests de las vistas del dashboard (CLAUDE.md §4.12, §9): cada aliado ve solo lo suyo y nunca su id.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

create function pg_temp.aliado(id uuid, email text, tipo text, rol text default 'aliado')
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, raw_user_meta_data) values (id, email, jsonb_build_object(
    'nombre_completo', 'Prueba ' || tipo, 'celular', '+5730' || lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0'), 'tipo_aliado', tipo,
    'organizacion', 'Banco Prueba', 'cargo', 'Ejecutiva', 'como_llega_empresas', 'Red',
    'autorizacion_datos', true, 'acepta_terminos', true));
  update public.aliados set estado = 'activo', rol = aliado.rol where aliados.id = aliado.id;
end;
$$;

create function pg_temp.empresa(id uuid, aliado uuid, nombre text, ciudad text)
returns void language sql as $$
  insert into public.empresas (id, aliado_id, origen, empresa, sector, ciudad, nombre_contacto, telefono, correo, valor_factura, es_perfecto, autorizacion_contacto_at)
  values (empresa.id, empresa.aliado, 'hub', empresa.nombre, 'Industrial', empresa.ciudad, 'Contacto', '3001234567',
          empresa.id || '@vistas.test', 1000000, false, now());
  insert into public.avance_empresa (empresa_id) values (empresa.id);
$$;

create function pg_temp.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- A: EMI con dos referidos (uno calificado y con valores de Clientify) y un módulo. B: financiero. C: admin.
select pg_temp.aliado('a3000000-0000-0000-0000-000000000001', 'a@vistas.test', 'emi');
select pg_temp.aliado('b3000000-0000-0000-0000-000000000001', 'b@vistas.test', 'financiero');
select pg_temp.aliado('c3000000-0000-0000-0000-000000000001', 'c@vistas.test', 'linker', 'admin');

select pg_temp.empresa('e3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'Alfa S.A.S.', 'Bucaramanga');
select pg_temp.empresa('e3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'Beta Ltda.', 'Medellín');
select pg_temp.empresa('e3000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000001', 'Gamma', 'Cali');

insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por)
values ('a3000000-0000-0000-0000-000000000001', 'ganado', 'registro_valido', 'empresas', 'e3000000-0000-0000-0000-000000000001',
        'empresa:e3000000-0000-0000-0000-000000000001:registro_valido', 'sistema'),
       ('a3000000-0000-0000-0000-000000000001', 'perdido', 'referido_imperfecto', 'empresas', 'e3000000-0000-0000-0000-000000000001',
        'empresa:e3000000-0000-0000-0000-000000000001:perfecto', 'sistema');
select public.aplicar_avance_clientify('e3000000-0000-0000-0000-000000000001',
  '{"valor_cotizado": 250000000, "valor_oportunidad": 250000000, "potencia_instalada_kwp": 410}'::jsonb,
  '{"calificado": "si", "perfecto": "no", "oportunidad_tecnica": "si", "integridad_informacion": "si"}'::jsonb);
select public.aplicar_avance_clientify('e3000000-0000-0000-0000-000000000002', '{}'::jsonb, '{"calificado": "no"}'::jsonb);
select public.completar_modulo('a3000000-0000-0000-0000-000000000001', 'c11');
-- Gamma (de B) llega a la oferta y al contrato: fechas de la serie mensual (oct 2026).
select public.aplicar_avance_clientify('e3000000-0000-0000-0000-000000000003', '{}'::jsonb,
  '{"calificado": "si", "oportunidad_tecnica": "si", "propuesta_comercial": "si", "negocio_cerrado": "si"}'::jsonb);

-- Estructura y privilegios -------------------------------------------------------------------------------

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name in ('v_aliado_dashboard', 'v_mis_movimientos', 'v_mis_referidos', 'v_mis_modulos')
     and column_name in ('id', 'aliado_id')),
  0::bigint, 'ninguna vista expone id ni aliado_id');
select ok(not has_table_privilege('anon', 'public.v_aliado_dashboard', 'select')
      and not has_table_privilege('anon', 'public.v_mis_movimientos', 'select')
      and not has_table_privilege('anon', 'public.v_mis_referidos', 'select')
      and not has_table_privilege('anon', 'public.v_mis_modulos', 'select'),
  'anon no puede leer las vistas');
select ok(not has_table_privilege('authenticated', 'public.v_aliado_dashboard', 'insert'), 'las vistas son de solo lectura');

-- Aliado A ------------------------------------------------------------------------------------------------

set local role authenticated;
select pg_temp.como('a3000000-0000-0000-0000-000000000001');

select is((select count(*) from public.v_aliado_dashboard), 1::bigint, 'A ve una sola fila de resumen');
select is((select codigo_aliado from public.v_aliado_dashboard),
          (select codigo_aliado from public.aliados where id = 'a3000000-0000-0000-0000-000000000001'), 'y es la suya');
select row_eq(
  $$select referidos_total, referidos_calificados, referidos_no_continuan, referidos_activos, referidos_cerrados from public.v_aliado_dashboard$$,
  row(2, 1, 1, 1, 0), 'conteos de referidos: 2 en total, 1 calificado, 1 que no continúa, 1 activo');
select row_eq(
  $$select puntos_disponibles, puntos_nivel, nivel::text from public.v_aliado_dashboard$$,
  row(10 - 5 + 30 + 30 - 10 + 5, 10 - 5 + 30 + 30 - 10 + 5, 'bronce'::text),
  'puntos del libro mayor (registro, imperfecto, calificada, evaluación, no calificado y módulo)');
select row_eq(
  $$select potencia_kwp, valor_cotizado, pipeline_originado from public.v_aliado_dashboard$$,
  row(410::numeric, 250000000::numeric, 250000000::numeric), 'indicadores de Financieros sumados');
select row_eq(
  $$select racha_semana_1, racha_semana_actual from public.v_aliado_dashboard$$,
  row(true, true), 'la racha refleja la calificación de esta semana');
select row_eq(
  $$select modulos_completados, modulos_pendientes, puntos_modulos_mes from public.v_aliado_dashboard$$,
  row(1, 0, 5), 'módulos completados y puntos de módulos del mes');
select is((select empresas_evaluadas from public.v_aliado_dashboard), 1, 'una empresa con calidad calculada respalda la calidad');

select is((select count(*) from public.v_mis_movimientos), 6::bigint, 'A ve sus 6 movimientos');
select is((select count(*) from public.v_mis_movimientos where empresa = 'Alfa S.A.S.'), 4::bigint,
  'los movimientos de una empresa traen su nombre');
select is((select modulo from public.v_mis_movimientos where motivo = 'modulo_completado'), '¿Qué empresas vale la pena referir?',
  'el movimiento de un módulo trae su nombre');
select is((select descripcion from public.v_mis_movimientos where motivo = 'referido_imperfecto'), 'Referido imperfecto',
  'cada movimiento trae la descripción de la regla');

select is((select count(*) from public.v_mis_referidos), 2::bigint, 'A ve sus 2 referidos');
select is((select etapa from public.v_mis_referidos where empresa = 'Alfa S.A.S.'), 'dtp', 'calificada con evaluación técnica → dtp');
select is((select etapa from public.v_mis_referidos where empresa = 'Beta Ltda.'), 'noviable', 'no calificada → noviable');
select is((select puntos from public.v_mis_referidos where empresa = 'Alfa S.A.S.'), 10 - 5 + 30 + 30, 'puntos netos por empresa');
select row_eq($$select fecha_propuesta, fecha_cierre from public.v_mis_referidos where empresa = 'Alfa S.A.S.'$$,
  row(null::timestamptz, null::timestamptz), 'sin oferta ni contrato, las fechas de la serie quedan vacías');

select is((select count(*) from public.v_mis_modulos), 11::bigint, 'A ve el catálogo activo de la Academy');
select row_eq($$select recompensa_estado, puntos_al_completar from public.v_mis_modulos where codigo = 'c11'$$,
  row('otorgada'::text, 5), 'con su estado en cada módulo');
select is((select count(*) from public.v_mis_modulos where recompensa_estado is not null), 1::bigint, 'y sin los módulos de otros');

-- B y el admin C ---------------------------------------------------------------------------------------

select pg_temp.como('b3000000-0000-0000-0000-000000000001');
select is((select array_agg(empresa) from public.v_mis_referidos), array['Gamma'], 'B solo ve su referido');
select row_eq($$select fecha_propuesta = (select min(fecha) from public.movimientos_puntos where motivo = 'propuesta_comercial' and vinculo_id = 'e3000000-0000-0000-0000-000000000003'),
                       fecha_cierre is not null from public.v_mis_referidos$$,
  row(true, true), 'la serie mensual tiene la fecha en que el referido llegó a la oferta y al contrato');

select pg_temp.como('c3000000-0000-0000-0000-000000000001');
select is((select count(*) from public.v_mis_referidos) + (select count(*) from public.v_mis_movimientos), 0::bigint,
  'un admin ve en estas vistas solo lo suyo, no lo de todos');

reset role;
select * from finish();
rollback;
