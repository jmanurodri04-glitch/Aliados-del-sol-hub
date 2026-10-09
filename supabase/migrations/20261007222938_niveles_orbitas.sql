-- Niveles nuevos: KILO, MEGA, GIGA, TERA, PETA y EXA (decisión del equipo, oct 2026; CLAUDE.md §6.3).
--
-- 1. Se renombran los valores del enum `nivel` en el mismo orden (bronce → kilo, plata → mega, oro → giga,
--    platino → tera, diamante → peta, circulo_solar → exa). Como el orden no cambia, las comparaciones del canje
--    («nivel actual ≥ nivel mínimo», por API y por QR) siguen igual, y todo lo guardado (nivel de cada aliado,
--    nivel mínimo de cada recompensa y nivel con que se hizo cada canje) queda traducido.
-- 2. Rangos nuevos de puntos de nivel (misma ventana de 6 meses): KILO 0–479, MEGA 480–959, GIGA 960–1439,
--    TERA 1440–1919, PETA 1920–2399, EXA 2400 o más. Calidad mínima igual que antes: MEGA 50 %, GIGA 60 %,
--    TERA 70 %, PETA 80 %, EXA 85 %.
-- 3. Requisito nuevo de GIGA en adelante: al menos un referido que haya llegado a «Presentación de oferta» o a una fase
--    posterior (propuesta_comercial = 'si', o negocio_cerrado = 'si'). No vence: con que exista, se mantiene.
-- 4. El nivel es el más alto cuyas condiciones se cumplen todas; los puntos se miran primero y la calidad y la
--    cotización pueden bajarlo. Nadie queda sin nivel: KILO es el piso. Las reglas de puntos no cambian.

alter type public.nivel rename value 'bronce' to 'kilo';
alter type public.nivel rename value 'plata' to 'mega';
alter type public.nivel rename value 'oro' to 'giga';
alter type public.nivel rename value 'platino' to 'tera';
alter type public.nivel rename value 'diamante' to 'peta';
alter type public.nivel rename value 'circulo_solar' to 'exa';

-- Función pura: puntos de nivel, calidad (NULL cuenta como 0) y si tiene al menos una cotización.
create function public.calcular_nivel(puntos integer, calidad numeric, cotizacion boolean)
returns public.nivel
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when coalesce(puntos, 0) >= 2400 and coalesce(calidad, 0) >= 85 and coalesce(cotizacion, false) then 'exa'::public.nivel
    when coalesce(puntos, 0) >= 1920 and coalesce(calidad, 0) >= 80 and coalesce(cotizacion, false) then 'peta'::public.nivel
    when coalesce(puntos, 0) >= 1440 and coalesce(calidad, 0) >= 70 and coalesce(cotizacion, false) then 'tera'::public.nivel
    when coalesce(puntos, 0) >=  960 and coalesce(calidad, 0) >= 60 and coalesce(cotizacion, false) then 'giga'::public.nivel
    when coalesce(puntos, 0) >=  480 and coalesce(calidad, 0) >= 50 then 'mega'::public.nivel
    else 'kilo'::public.nivel
  end;
$$;
revoke execute on function public.calcular_nivel(integer, numeric, boolean) from public, anon;
grant execute on function public.calcular_nivel(integer, numeric, boolean) to authenticated;

-- La versión de dos argumentos se conserva por compatibilidad y equivale a «sin cotización» (nunca pasa de MEGA).
create or replace function public.calcular_nivel(puntos integer, calidad numeric)
returns public.nivel
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.calcular_nivel(puntos, calidad, false);
$$;

-- ¿El aliado tiene al menos un referido en «Presentación de oferta» o después? (sin ventana de tiempo)
create function interno.tiene_cotizacion(p_aliado uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.empresas e
    join public.avance_empresa av on av.empresa_id = e.id
    where e.aliado_id = p_aliado
      and (av.propuesta_comercial = 'si' or av.negocio_cerrado = 'si')
  );
$$;
revoke execute on function interno.tiene_cotizacion(uuid) from public, anon, authenticated;

-- La caché del aliado usa la regla nueva. Se recalcula en cada movimiento, al cambiar avance_empresa (la cotización
-- llega por ahí) y en el cron diario.
create or replace function interno.recalcular_aliado(p_aliado uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_disponibles integer := public.calcular_puntos_disponibles(p_aliado);
  v_nivel_pts   integer := public.calcular_puntos_nivel(p_aliado);
  v_calidad     numeric := public.calcular_calidad_referidos(p_aliado);
  v_nivel       public.nivel := public.calcular_nivel(v_nivel_pts, v_calidad, interno.tiene_cotizacion(p_aliado));
begin
  update public.aliados a
  set puntos_disponibles = v_disponibles,
      puntos_nivel       = v_nivel_pts,
      calidad_referidos  = v_calidad,
      nivel              = v_nivel
  where a.id = p_aliado
    and (a.puntos_disponibles, a.puntos_nivel, a.calidad_referidos, a.nivel)
        is distinct from (v_disponibles, v_nivel_pts, v_calidad, v_nivel);
end;
$$;

-- La cotización cambia el nivel: si un referido llega a «Presentación de oferta» (o se corrige desde el panel) sin que
-- entre un movimiento de puntos, el aliado se recalcula igual.
create trigger avance_empresa_recalcular_cotizacion
  after update of propuesta_comercial, negocio_cerrado on public.avance_empresa
  for each row
  when (old.propuesta_comercial is distinct from new.propuesta_comercial or old.negocio_cerrado is distinct from new.negocio_cerrado)
  execute function interno.avance_empresa_recalcular();

-- El nivel mínimo por defecto de una recompensa nueva pasa a 'kilo' (el resto de la función no cambia).
create or replace function public.admin_guardar_recompensa(p_admin uuid, p_recompensa uuid, p_datos jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin     text := interno.exigir_admin(p_admin);
  v_datos     jsonb := coalesce(p_datos, '{}'::jsonb);
  v_codigo    text := lower(btrim(coalesce(v_datos ->> 'codigo', '')));
  v_nombre    text := btrim(coalesce(v_datos ->> 'nombre', ''));
  v_desc      text := nullif(btrim(coalesce(v_datos ->> 'descripcion', '')), '');
  v_categoria text := nullif(btrim(coalesce(v_datos ->> 'categoria', '')), '');
  v_proveedor text := nullif(lower(btrim(coalesce(v_datos ->> 'proveedor', ''))), '');
  v_con_img   boolean := v_datos ? 'imagen_path';
  v_imagen    text := nullif(btrim(coalesce(v_datos ->> 'imagen_path', '')), '');
  v_puntos    integer;
  v_nivel     public.nivel;
  v_activa    boolean;
  v_id        uuid;
  v_anterior  public.recompensas%rowtype;
  v_img_antes text;
begin
  begin
    v_puntos := (v_datos ->> 'puntos')::integer;
    v_nivel  := coalesce(nullif(v_datos ->> 'nivel_minimo', ''), 'kilo')::public.nivel;
    v_activa := coalesce((v_datos ->> 'activa')::boolean, true);
  exception when others then
    raise exception 'dato_invalido: los puntos, el nivel o el estado no son válidos';
  end;
  if char_length(v_nombre) not between 3 and 120 then
    raise exception 'dato_invalido: el nombre debe tener entre 3 y 120 caracteres';
  end if;
  if v_puntos is null or v_puntos not between 1 and 100000 then
    raise exception 'dato_invalido: los puntos deben estar entre 1 y 100000';
  end if;
  if char_length(v_desc) > 1000 or char_length(v_categoria) > 40 then
    raise exception 'dato_invalido: la descripción o la categoría son demasiado largas';
  end if;
  if v_proveedor is not null and v_proveedor !~ '^[a-z0-9_-]{2,40}$' then
    raise exception 'dato_invalido: el proveedor solo admite minúsculas, números, guion y guion bajo';
  end if;
  if v_imagen is not null then
    if v_imagen !~ '^[0-9a-f-]{36}\.(jpg|png|webp)$' then
      raise exception 'dato_invalido: la imagen no es válida';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'recompensas' and o.name = v_imagen) then
      raise exception 'dato_invalido: la imagen no se subió; vuelve a elegirla';
    end if;
  end if;

  if p_recompensa is null then
    if v_codigo !~ '^[a-z0-9][a-z0-9_-]{1,39}$' then
      raise exception 'dato_invalido: el código solo admite minúsculas, números, guion y guion bajo (2 a 40)';
    end if;
    if exists (select 1 from public.recompensas r where r.codigo = v_codigo) then
      raise exception 'estado_invalido: ya existe una recompensa con el código %', v_codigo;
    end if;
    insert into public.recompensas (codigo, nombre, descripcion, categoria, puntos, nivel_minimo, proveedor, activa, imagen_path)
    values (v_codigo, v_nombre, v_desc, v_categoria, v_puntos, v_nivel, v_proveedor, v_activa, v_imagen)
    returning id into v_id;
  else
    select * into v_anterior from public.recompensas r where r.id = p_recompensa for update;
    if not found then
      raise exception 'recompensa_inexistente: la recompensa no existe';
    end if;
    if not v_con_img then
      v_imagen := v_anterior.imagen_path;
    elsif v_anterior.imagen_path is distinct from v_imagen then
      v_img_antes := v_anterior.imagen_path;
    end if;
    update public.recompensas r
    set nombre = v_nombre, descripcion = v_desc, categoria = v_categoria, puntos = v_puntos,
        nivel_minimo = v_nivel, proveedor = v_proveedor, activa = v_activa, imagen_path = v_imagen
    where r.id = p_recompensa;
    v_id := p_recompensa;
    v_codigo := v_anterior.codigo;
  end if;

  perform interno.registrar_accion_admin(p_admin, v_admin, 'guardar_recompensa', null, null, 'recompensa:' || v_codigo,
    jsonb_build_object('nueva', p_recompensa is null, 'nombre', v_nombre, 'puntos', v_puntos, 'nivel_minimo', v_nivel,
      'proveedor', v_proveedor, 'activa', v_activa, 'imagen', v_imagen,
      'antes', case when p_recompensa is null then null
                    else jsonb_build_object('nombre', v_anterior.nombre, 'puntos', v_anterior.puntos,
                           'nivel_minimo', v_anterior.nivel_minimo, 'proveedor', v_anterior.proveedor,
                           'activa', v_anterior.activa, 'imagen', v_anterior.imagen_path) end));
  return jsonb_build_object('recompensa_id', v_id, 'codigo', v_codigo, 'activa', v_activa, 'imagen_path', v_imagen,
    'imagen_anterior', v_img_antes);
end;
$$;

-- Todos los aliados quedan con su nivel según la regla nueva.
select interno.recalcular_todos();
