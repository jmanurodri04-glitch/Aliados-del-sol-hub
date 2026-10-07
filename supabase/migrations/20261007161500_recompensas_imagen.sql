-- Imagen de cada recompensa (decisión del equipo, oct 2026): el admin la sube desde el panel (pestaña Recompensas) y el
-- aliado la ve en la tarjeta de Beneficios del Hub.
-- * Bucket público de solo lectura `recompensas` (2 MB; JPG, PNG o WebP). No tiene políticas: el panel sube con una URL
--   firmada de un solo uso que da `/api/admin` y nadie más escribe. Es público porque la imagen no tiene datos personales
--   y así el Hub la muestra sin pedir URLs firmadas.
-- * `recompensas.imagen_path` guarda el nombre del archivo (`<uuid>.<ext>`); `admin_guardar_recompensa` lo valida y
--   comprueba que exista en el bucket. Si la clave `imagen_path` no viene en los datos, se conserva la imagen actual;
--   si viene vacía, se quita. Devuelve `imagen_anterior` cuando la imagen cambió, para que el servidor borre el archivo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recompensas', 'recompensas', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

alter table public.recompensas
  add column imagen_path text
    constraint recompensas_imagen_path_formato check (imagen_path ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$');

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
    v_nivel  := coalesce(nullif(v_datos ->> 'nivel_minimo', ''), 'bronce')::public.nivel;
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

-- Las vistas ganan la imagen al final (create or replace solo permite agregar columnas al final).
create or replace view public.v_recompensas
with (security_invoker = true)
as
select r.codigo, r.nombre, r.descripcion, r.categoria, r.puntos, r.nivel_minimo,
       (a.estado = 'activo' and a.nivel >= r.nivel_minimo and a.puntos_disponibles >= r.puntos) as disponible,
       a.nivel < r.nivel_minimo as falta_nivel,
       greatest(r.puntos - a.puntos_disponibles, 0) as puntos_faltantes,
       r.imagen_path
from public.recompensas r
join public.aliados a on a.id = (select auth.uid())
where r.activa;

create or replace view public.v_admin_recompensas
with (security_invoker = true)
as
select r.id as recompensa_id, r.codigo, r.nombre, r.descripcion, r.categoria, r.puntos, r.nivel_minimo, r.proveedor,
       r.activa, r.created_at, r.updated_at,
       coalesce(k.canjes, 0)::integer as canjes_confirmados,
       coalesce(k.puntos, 0)::integer as puntos_redimidos,
       r.imagen_path
from public.recompensas r
left join lateral (
  select count(*) as canjes, sum(c.puntos) as puntos
  from public.canjes c where c.recompensa_id = r.id and c.estado = 'confirmado'
) k on true
where (select interno.es_admin());
