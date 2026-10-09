-- Fase 1 · 05 — Generación de codigo_aliado (CLAUDE.md §2) y cálculo de nivel (§6.3).

-- Prefijo por tipo de aliado.
create function public.prefijo_tipo_aliado(tipo public.tipo_aliado)
returns text
language sql
immutable
set search_path = ''
as $$
  select case tipo
    when 'financiero'        then 'FI'
    when 'emi'               then 'EM'
    when 'linker'            then 'LK'
    when 'cliente_embajador' then 'CE'
    when 'agremiaciones'     then 'AG'
  end;
$$;

-- Iniciales del nombre: primera letra de cada palabra, en mayúscula y sin tildes.
-- Se ignoran las partículas (de, del, la, las, los, y) y se toman máximo 4 letras.
-- Si no queda ninguna letra, devuelve 'X' para que el código siga siendo válido.
create function public.iniciales_nombre(nombre text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_normalizado text;
  v_palabra     text;
  v_iniciales   text := '';
begin
  v_normalizado := upper(translate(
    coalesce(nombre, ''),
    'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑÇáéíóúàèìòùäëïöüâêîôûãõñç',
    'AEIOUAEIOUAEIOUAEIOUAONCaeiouaeiouaeiouaeiouaonc'
  ));

  foreach v_palabra in array regexp_split_to_array(btrim(v_normalizado), '[[:space:]-]+') loop
    v_palabra := regexp_replace(v_palabra, '[^A-Z]', '', 'g');
    continue when v_palabra = '' or v_palabra in ('DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y');
    v_iniciales := v_iniciales || left(v_palabra, 1);
    exit when length(v_iniciales) = 4;
  end loop;

  return case when v_iniciales = '' then 'X' else v_iniciales end;
end;
$$;

-- Aleatorio criptográficamente seguro sobre el alfabeto sin caracteres confusos (sin 0 O 1 I L).
-- Usa muestreo por rechazo (bytes >= 248 = 31 × 8 se descartan) para que no haya sesgo.
create function public.aleatorio_codigo(longitud integer default 8)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 31 caracteres
  v_resultado text := '';
  v_bytes     bytea;
  v_byte      integer;
begin
  if longitud is null or longitud < 1 then
    raise exception 'longitud debe ser >= 1';
  end if;

  while length(v_resultado) < longitud loop
    v_bytes := extensions.gen_random_bytes(longitud * 2);
    for i in 0 .. length(v_bytes) - 1 loop
      v_byte := get_byte(v_bytes, i);
      if v_byte < 248 then
        v_resultado := v_resultado || substr(c_alfabeto, (v_byte % 31) + 1, 1);
        exit when length(v_resultado) = longitud;
      end if;
    end loop;
  end loop;

  return v_resultado;
end;
$$;

-- PREFIJO_TIPO + INICIALES + ALEATORIO_8, regenerando mientras colisione.
-- El índice UNIQUE de aliados.codigo_aliado respalda la unicidad ante carreras.
create function public.generar_codigo_aliado(nombre text, tipo public.tipo_aliado)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_base   text;
  v_codigo text;
begin
  if tipo is null then
    raise exception 'tipo_aliado es obligatorio para generar el código';
  end if;

  v_base := public.prefijo_tipo_aliado(tipo) || public.iniciales_nombre(nombre);

  loop
    v_codigo := v_base || public.aleatorio_codigo(8);
    exit when not exists (select 1 from public.aliados a where a.codigo_aliado = v_codigo);
  end loop;

  return v_codigo;
end;
$$;

-- Nivel según puntos_nivel y calidad_referidos, evaluado de arriba hacia abajo (§6.3).
-- Deben cumplirse puntos Y calidad. Calidad NULL cuenta como 0. Bronce es el nivel por defecto.
create function public.calcular_nivel(puntos integer, calidad numeric)
returns public.nivel
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when coalesce(puntos, 0) >= 1000 and coalesce(calidad, 0) >= 85 then 'circulo_solar'::public.nivel
    when coalesce(puntos, 0) >=  700 and coalesce(calidad, 0) >= 80 then 'diamante'::public.nivel
    when coalesce(puntos, 0) >=  450 and coalesce(calidad, 0) >= 70 then 'platino'::public.nivel
    when coalesce(puntos, 0) >=  250 and coalesce(calidad, 0) >= 60 then 'oro'::public.nivel
    when coalesce(puntos, 0) >=  100 and coalesce(calidad, 0) >= 50 then 'plata'::public.nivel
    else 'bronce'::public.nivel
  end;
$$;

-- La generación de códigos solo la usa el servidor (trigger de alta en la fase 2).
revoke execute on function public.aleatorio_codigo(integer) from public, anon, authenticated;
revoke execute on function public.generar_codigo_aliado(text, public.tipo_aliado) from public, anon, authenticated;
revoke execute on function public.iniciales_nombre(text) from public, anon, authenticated;
revoke execute on function public.prefijo_tipo_aliado(public.tipo_aliado) from public, anon, authenticated;
-- calcular_nivel es pura y el front la puede usar para mostrar el progreso al siguiente nivel.
revoke execute on function public.calcular_nivel(integer, numeric) from public, anon;
grant execute on function public.calcular_nivel(integer, numeric) to authenticated;
