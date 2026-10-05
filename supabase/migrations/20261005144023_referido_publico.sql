-- Correcciones · Referido desde el formulario público del Hub (CLAUDE.md §7.1, §7.2; decisión del equipo, oct 2026).
--
-- El formulario de Clientify ("Refiere tu empresa") se reemplazó por uno propio, igual al de "Nueva oportunidad",
-- que pide el correo de quien refiere. Si el correo es de un aliado (activo, pendiente o suspendido), la empresa
-- entra al Hub de ese aliado con las mismas reglas del Hub y pasa a Clientify por el flujo B. Si no, no se registra
-- y el navegador recibe un mensaje ambiguo (no revela si el correo es de un aliado).
--
--   · empresas.canal: 'sesion' (Nueva oportunidad con sesión) o 'publico' (formulario público). Solo origen = 'hub'.
--   · interno.registrar_oportunidad_base: la lógica de siempre, compartida por los dos canales.
--   · public.registrar_oportunidad: sin cambios por fuera (aliado de la sesión, cuenta activa).
--   · public.registrar_oportunidad_publica: busca al aliado por correo; un pendiente o suspendido queda con los
--     puntos retenidos (§4.7). No devuelve saldo ni nivel: quien llena el formulario puede no ser el aliado.
--   · Abuso: máximo 10 intentos por hora por conexión (huella HMAC de la IP, nunca la IP) y la factura pública
--     solo se acepta con el permiso que emitió /api/oportunidades/factura tras verificar el captcha.
--   · Sin borrados: el contador por conexión se reinicia solo y los permisos usados o vencidos no sirven.

-- Canal de las oportunidades del Hub --------------------------------------------------------------------

alter table public.empresas add column canal text check (canal in ('sesion', 'publico'));
update public.empresas set canal = 'sesion' where origen = 'hub';
alter table public.empresas add constraint empresas_canal_hub check ((origen = 'hub') = (canal is not null));
comment on column public.empresas.canal is 'Solo origen hub: sesion (Nueva oportunidad) o publico (formulario público del Hub).';

-- Una empresa del Hub que llega sin canal es de "Nueva oportunidad" (lo que eran todas antes de esta migración).
create function interno.empresas_canal_por_defecto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.origen = 'hub' and new.canal is null then
    new.canal := 'sesion';
  end if;
  return new;
end;
$$;
create trigger empresas_canal_por_defecto
  before insert on public.empresas
  for each row execute function interno.empresas_canal_por_defecto();

-- Intentos y permisos del formulario público (solo el servidor) ------------------------------------------

-- Una fila por conexión con su ventana de una hora (no crece con cada envío y no guarda el historial).
create table public.referidos_publicos_intentos (
  huella          text primary key check (huella ~ '^[0-9a-f]{64}$'),   -- HMAC-SHA256 de la IP; nunca la IP
  ventana_inicio  timestamptz not null default now(),
  intentos        integer not null default 1 check (intentos >= 0)
);
comment on table public.referidos_publicos_intentos is 'Envíos del formulario público por conexión en la ventana de una hora (límite anti-abuso).';

create table public.referidos_publicos_permisos (
  empresa_id  uuid primary key,
  huella      text not null check (huella ~ '^[0-9a-f]{64}$'),
  creado_at   timestamptz not null default now(),
  vence_at    timestamptz not null default now() + interval '30 minutes',
  usado_at    timestamptz
);
comment on table public.referidos_publicos_permisos is 'Permiso de un solo uso para registrar con factura (captcha verificado al pedir la subida).';

alter table public.referidos_publicos_intentos enable row level security;
alter table public.referidos_publicos_permisos enable row level security;
revoke all on table public.referidos_publicos_intentos from anon, authenticated;
revoke all on table public.referidos_publicos_permisos from anon, authenticated;
grant all on table public.referidos_publicos_intentos to service_role;
grant all on table public.referidos_publicos_permisos to service_role;

-- Cuenta un intento y dice si la conexión sigue dentro del límite de la hora (la ventana se reinicia sola).
create function public.referido_publico_intento(p_huella text, p_limite integer default 10)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_intentos integer;
begin
  if p_huella is null or p_huella !~ '^[0-9a-f]{64}$' then
    raise exception 'dato_invalido: huella inválida';
  end if;
  insert into public.referidos_publicos_intentos as i (huella) values (p_huella)
  on conflict (huella) do update
    set ventana_inicio = case when i.ventana_inicio <= now() - interval '1 hour' then now() else i.ventana_inicio end,
        intentos       = case when i.ventana_inicio <= now() - interval '1 hour' then 1 else i.intentos + 1 end
  returning i.intentos into v_intentos;
  return v_intentos <= greatest(coalesce(p_limite, 10), 1);
end;
$$;

-- Permiso para registrar con factura (lo crea /api/oportunidades/factura después de verificar el captcha).
create function public.referido_publico_permiso(p_empresa_id uuid, p_huella text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_empresa_id is null or p_huella is null or p_huella !~ '^[0-9a-f]{64}$' then
    raise exception 'dato_invalido: permiso inválido';
  end if;
  insert into public.referidos_publicos_permisos (empresa_id, huella) values (p_empresa_id, p_huella);
end;
$$;

-- Lógica común del registro --------------------------------------------------------------------------------
-- Igual a la de la fase 5; cambian el estado de cuenta permitido y la carpeta de la factura según el canal:
--   sesion  → cuenta activa; factura en {aliado}/{empresa}/…
--   publico → cuenta activa, pendiente o suspendida (puntos retenidos); factura en publico/{empresa}/…
-- Errores con prefijo estable: aliado_no_activo · limite_referidos · referido_duplicado · autorreferido ·
-- oportunidad_invalida · factura_invalida.
create function interno.registrar_oportunidad_base(
  p_aliado uuid, p_empresa_id uuid, p_datos jsonb, p_factura jsonb, p_canal text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_limite_hora constant integer := 20;
  v_aliado      public.aliados%rowtype;
  v_empresa     text    := nullif(btrim(p_datos ->> 'empresa'), '');
  v_sector      text    := nullif(btrim(p_datos ->> 'sector'), '');
  v_subsector   text    := nullif(btrim(p_datos ->> 'subsector'), '');
  v_ciudad      text    := nullif(btrim(p_datos ->> 'ciudad'), '');
  v_contacto    text    := nullif(btrim(p_datos ->> 'nombre_contacto'), '');
  v_cargo       text    := nullif(btrim(p_datos ->> 'cargo'), '');
  v_telefono    text    := nullif(btrim(p_datos ->> 'telefono'), '');
  v_correo      text    := lower(nullif(btrim(p_datos ->> 'correo'), ''));
  v_obs         text    := nullif(btrim(p_datos ->> 'observaciones'), '');
  v_valor       numeric;
  v_ruta        text    := nullif(btrim(p_factura ->> 'storage_path'), '');
  v_nombre_arch text    := nullif(btrim(p_factura ->> 'nombre_archivo'), '');
  v_carpeta     text;
  v_objeto      record;
  v_tipo_doc    text;
  v_factura_id  uuid;
  v_perfecto    boolean;
  v_motivos     text[];
  v_resultado   public.aliados%rowtype;
begin
  if p_canal not in ('sesion', 'publico') then
    raise exception 'oportunidad_invalida: canal desconocido';
  end if;

  -- Aliado bloqueado para serializar sus envíos y contar bien el límite por hora.
  select * into v_aliado from public.aliados a where a.id = p_aliado for update;
  if not found
     or (p_canal = 'sesion' and v_aliado.estado <> 'activo')
     or (p_canal = 'publico' and (v_aliado.estado not in ('activo', 'pendiente', 'suspendido') or v_aliado.rol <> 'aliado')) then
    raise exception 'aliado_no_activo: esta cuenta no puede registrar oportunidades';
  end if;

  if (select count(*) from public.empresas e
      where e.aliado_id = p_aliado and e.origen = 'hub' and e.created_at > now() - interval '1 hour') >= c_limite_hora then
    raise exception 'limite_referidos: máximo % referidos por hora', c_limite_hora;
  end if;

  -- Campos obligatorios y formatos (§7.2). El front valida lo mismo.
  if v_empresa is null or v_sector is null or v_contacto is null or v_telefono is null or v_correo is null then
    raise exception 'oportunidad_invalida: faltan campos obligatorios';
  end if;
  if greatest(length(v_empresa), length(v_sector), length(coalesce(v_subsector, '')), length(coalesce(v_ciudad, '')),
              length(v_contacto), length(coalesce(v_cargo, ''))) > 200 or length(coalesce(v_obs, '')) > 2000 then
    raise exception 'oportunidad_invalida: un campo supera la longitud permitida';
  end if;
  if v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'oportunidad_invalida: correo del contacto inválido';
  end if;
  if v_telefono !~ '^\+[1-9][0-9]{6,14}$' or (v_telefono like '+57%' and v_telefono !~ '^\+573[0-9]{9}$') then
    raise exception 'oportunidad_invalida: teléfono del contacto inválido';
  end if;
  begin
    v_valor := (p_datos ->> 'valor_factura')::numeric;
  exception when others then
    v_valor := null;
  end;
  if v_valor is null or v_valor <= 0 or v_valor >= 1e12 then
    raise exception 'oportunidad_invalida: valor de la factura inválido';
  end if;
  if coalesce(p_datos ->> 'autorizacion_contacto', '') <> 'true' then
    raise exception 'oportunidad_invalida: falta la declaración de autorización del contacto';
  end if;

  -- Reglas del programa (términos): no referirse a sí mismo y un contacto solo se refiere una vez.
  if v_correo = lower(v_aliado.correo) or v_telefono = v_aliado.celular then
    raise exception 'autorreferido: un aliado no puede referirse a sí mismo';
  end if;
  if exists (select 1 from public.empresas e where lower(e.correo) = v_correo) then
    raise exception 'referido_duplicado: este contacto ya fue referido';
  end if;

  -- Factura: debe haberse subido al bucket, en la carpeta de esta empresa (y del aliado, con sesión).
  if v_ruta is not null then
    v_carpeta := case p_canal when 'sesion' then p_aliado::text || '/' || p_empresa_id::text || '/'
                              else 'publico/' || p_empresa_id::text || '/' end;
    if left(v_ruta, length(v_carpeta)) <> v_carpeta or position('..' in v_ruta) > 0 then
      raise exception 'factura_invalida: la factura no pertenece a esta oportunidad';
    end if;
    select o.metadata ->> 'mimetype' as tipo, (o.metadata ->> 'size')::bigint as tamano into v_objeto
    from storage.objects o where o.bucket_id = 'facturas' and o.name = v_ruta;
    if not found then
      raise exception 'factura_invalida: no se encontró el archivo subido';
    end if;
    v_tipo_doc := case v_objeto.tipo when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' end;
    if v_tipo_doc is null or coalesce(v_objeto.tamano, 0) > 10485760 then
      raise exception 'factura_invalida: solo PDF, JPG o PNG de máximo 10 MB';
    end if;
  end if;

  -- Referido perfecto: los 10 campos, incluida la factura (§4.4). Observaciones no cuenta.
  v_perfecto := v_subsector is not null and v_ciudad is not null and v_cargo is not null and v_ruta is not null;

  begin
    insert into public.empresas (id, aliado_id, origen, canal, empresa, sector, subsector, ciudad, nombre_contacto, cargo,
                                 telefono, correo, valor_factura, observaciones, es_perfecto, autorizacion_contacto_at)
    values (p_empresa_id, p_aliado, 'hub', p_canal, v_empresa, v_sector, v_subsector, v_ciudad, v_contacto, v_cargo,
            v_telefono, v_correo, v_valor, v_obs, v_perfecto, now());
  exception when unique_violation then
    raise exception 'referido_duplicado: este contacto ya fue referido';
  end;

  if v_ruta is not null then
    insert into public.facturas (empresa_id, aliado_id, tipo_documento, storage_path, nombre_archivo)
    values (p_empresa_id, p_aliado, v_tipo_doc, v_ruta, coalesce(v_nombre_arch, 'factura.' || v_tipo_doc))
    returning id into v_factura_id;
    update public.empresas set factura_id = v_factura_id where id = p_empresa_id;
  end if;

  insert into public.avance_empresa (empresa_id, perfecto)
  values (p_empresa_id, case when v_perfecto then 'si' else 'no' end::public.estado_triple);

  -- Puntos (§5): +10 por registro y +20 perfecto o −5 imperfecto. Si la cuenta no está activa, la base los
  -- retiene (movimientos_retenidos) y los acredita al activarse.
  v_motivos := array['registro_valido', case when v_perfecto then 'referido_perfecto' else 'referido_imperfecto' end];
  insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por)
  select p_aliado, r.tipo, r.motivo, 'empresas', p_empresa_id::text,
         'empresa:' || p_empresa_id || case when r.motivo = 'registro_valido' then ':registro_valido' else ':perfecto' end,
         'sistema'
  from unnest(v_motivos) with ordinality as m(motivo, orden)
  join public.reglas_puntos r on r.motivo = m.motivo
  order by m.orden
  on conflict (clave_unica) do nothing;

  select * into v_resultado from public.aliados a where a.id = p_aliado;
  return jsonb_build_object(
    'es_perfecto', v_perfecto,
    -- Puntos nominales de este referido (valen también si quedaron retenidos).
    'puntos_referido', (select sum(case r.tipo when 'perdido' then -r.puntos else r.puntos end)
                        from public.reglas_puntos r where r.motivo = any (v_motivos)),
    'movimientos', (select jsonb_agg(jsonb_build_object('motivo', m.motivo, 'tipo', m.tipo, 'puntos', m.puntos) order by m.secuencia)
                    from public.movimientos_puntos m where m.vinculo = 'empresas' and m.vinculo_id = p_empresa_id::text),
    'puntos_disponibles', v_resultado.puntos_disponibles,
    'puntos_nivel', v_resultado.puntos_nivel,
    'nivel', v_resultado.nivel
  );
end;
$$;

-- "Nueva oportunidad" con sesión: misma firma y la misma respuesta de siempre.
create or replace function public.registrar_oportunidad(p_aliado uuid, p_empresa_id uuid, p_datos jsonb, p_factura jsonb default null)
returns jsonb
language sql
set search_path = ''
as $$
  select interno.registrar_oportunidad_base(p_aliado, p_empresa_id, p_datos, p_factura, 'sesion') - 'puntos_referido';
$$;

-- Formulario público: el aliado se busca por su correo. Error referidor_invalido si no es un aliado que pueda
-- referir (inexistente, rechazado o cuenta de admin); el endpoint lo responde con un mensaje ambiguo.
-- Con factura exige el permiso de un solo uso de esa empresa (captcha verificado al pedir la subida).
create function public.registrar_oportunidad_publica(
  p_correo_aliado text, p_empresa_id uuid, p_datos jsonb, p_factura jsonb default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_aliado    uuid;
  v_resultado jsonb;
begin
  select a.id into v_aliado
  from public.aliados a
  where lower(a.correo) = lower(btrim(coalesce(p_correo_aliado, '')))
    and a.rol = 'aliado' and a.estado in ('activo', 'pendiente', 'suspendido');
  if v_aliado is null then
    raise exception 'referidor_invalido: el correo no corresponde a un aliado que pueda referir';
  end if;

  if nullif(btrim(p_factura ->> 'storage_path'), '') is not null then
    update public.referidos_publicos_permisos p
    set usado_at = now()
    where p.empresa_id = p_empresa_id and p.usado_at is null and p.vence_at > now();
    if not found then
      raise exception 'factura_invalida: el permiso para adjuntar la factura venció; vuelve a enviar el formulario';
    end if;
  end if;

  v_resultado := interno.registrar_oportunidad_base(v_aliado, p_empresa_id, p_datos, p_factura, 'publico');
  -- Solo lo de este referido: nunca el saldo, el nivel ni el código del aliado.
  return jsonb_build_object('es_perfecto', v_resultado -> 'es_perfecto', 'puntos', v_resultado -> 'puntos_referido');
end;
$$;

revoke execute on function interno.registrar_oportunidad_base(uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.registrar_oportunidad_publica(text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.referido_publico_intento(text, integer) from public, anon, authenticated;
revoke execute on function public.referido_publico_permiso(uuid, text) from public, anon, authenticated;
grant execute on function interno.registrar_oportunidad_base(uuid, uuid, jsonb, jsonb, text) to service_role;
grant execute on function public.registrar_oportunidad_publica(text, uuid, jsonb, jsonb) to service_role;
grant execute on function public.referido_publico_intento(text, integer) to service_role;
grant execute on function public.referido_publico_permiso(uuid, text) to service_role;
