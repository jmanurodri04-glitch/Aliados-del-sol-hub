-- Fase 5 · 01 — "Nueva oportunidad" desde el Hub y cola del flujo B hacia Clientify (CLAUDE.md §4.4, §4.5, §7.2, §8).
--
-- POST /api/oportunidades llama a public.registrar_oportunidad, que en UNA transacción valida, crea la empresa,
-- su factura y su avance, y otorga los puntos. Después, la empresa se sincroniza con Clientify por una cola
-- con reintentos (misma lógica que el flujo A).

-- Bucket privado de facturas (§4.5): 10 MB, PDF/JPG/PNG. Sin políticas: solo el servidor lo usa
-- (el navegador sube con una URL firmada de un solo uso que emite /api/oportunidades/factura).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas', 'facturas', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Empresas -------------------------------------------------------------------------------------

alter table public.empresas
  add column autorizacion_contacto_at   timestamptz,  -- declaración Ley 1581 del aliado sobre el contacto (§7.2)
  add column clientify_sync_intentos    integer not null default 0 check (clientify_sync_intentos >= 0),
  add column clientify_sync_proximo_at  timestamptz,
  add column clientify_sync_error       text,
  add column clientify_sync_at          timestamptz,
  add constraint empresas_autorizacion_contacto_hub check (origen <> 'hub' or autorizacion_contacto_at is not null);

-- Un contacto solo puede ser referido una vez: gana el primer aliado (decisión del equipo).
create unique index empresas_correo_contacto_key on public.empresas (lower(correo));

create index empresas_clientify_pendientes_idx on public.empresas (clientify_sync_proximo_at nulls first)
  where origen = 'hub' and clientify_sync_estado in ('pendiente', 'error');

alter table public.facturas
  add column clientify_subida_at timestamptz; -- cuándo se adjuntó a la empresa en Clientify

-- Registro de la oportunidad ------------------------------------------------------------------------

-- Errores con prefijo estable, que /api/oportunidades traduce a mensajes para el aliado:
--   aliado_no_activo · limite_referidos · referido_duplicado · autorreferido · oportunidad_invalida · factura_invalida
create function public.registrar_oportunidad(p_aliado uuid, p_empresa_id uuid, p_datos jsonb, p_factura jsonb default null)
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
  v_objeto      record;
  v_tipo_doc    text;
  v_factura_id  uuid;
  v_perfecto    boolean;
  v_motivos     text[];
  v_resultado   public.aliados%rowtype;
begin
  -- Aliado activo (bloqueado para serializar sus envíos y contar bien el límite por hora).
  select * into v_aliado from public.aliados a where a.id = p_aliado for update;
  if not found or v_aliado.estado <> 'activo' then
    raise exception 'aliado_no_activo: solo una cuenta activa puede registrar oportunidades';
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

  -- Factura: debe haberse subido al bucket, en la carpeta del aliado y de esta empresa.
  if v_ruta is not null then
    if v_ruta not like p_aliado::text || '/' || p_empresa_id::text || '/%' then
      raise exception 'factura_invalida: la factura no pertenece a este aliado';
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
    insert into public.empresas (id, aliado_id, origen, empresa, sector, subsector, ciudad, nombre_contacto, cargo,
                                 telefono, correo, valor_factura, observaciones, es_perfecto, autorizacion_contacto_at)
    values (p_empresa_id, p_aliado, 'hub', v_empresa, v_sector, v_subsector, v_ciudad, v_contacto, v_cargo,
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

  -- Puntos (§5): +10 por registro y +20 perfecto o −5 imperfecto. La base completa valores y saldos.
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
    'movimientos', (select jsonb_agg(jsonb_build_object('motivo', m.motivo, 'tipo', m.tipo, 'puntos', m.puntos) order by m.secuencia)
                    from public.movimientos_puntos m where m.vinculo = 'empresas' and m.vinculo_id = p_empresa_id::text),
    'puntos_disponibles', v_resultado.puntos_disponibles,
    'puntos_nivel', v_resultado.puntos_nivel,
    'nivel', v_resultado.nivel
  );
end;
$$;

-- Cola del flujo B ----------------------------------------------------------------------------

-- p_empresa: reclamar solo esa empresa (lo usa /api/oportunidades para sincronizar al momento).
create function public.clientify_reclamar_empresas(p_limite integer default 5, p_empresa uuid default null)
returns table (
  empresa_id           uuid,
  codigo_aliado        text,
  empresa              text,
  sector               text,
  subsector            text,
  ciudad               text,
  nombre_contacto      text,
  cargo                text,
  telefono             text,
  correo               text,
  valor_factura        numeric,
  observaciones        text,
  es_perfecto          boolean,
  clientify_company_id text,
  clientify_contact_id text,
  factura_storage_path text,
  factura_nombre       text,
  factura_tipo         text,
  factura_subida       boolean,
  intentos             integer
)
language sql
set search_path = ''
as $$
  with elegidas as (
    select e.id
    from public.empresas e
    where e.origen = 'hub'
      and e.clientify_sync_estado in ('pendiente', 'error')
      and (e.clientify_sync_proximo_at is null or e.clientify_sync_proximo_at <= now())
      and (p_empresa is null or e.id = p_empresa)
    order by e.clientify_sync_proximo_at nulls first, e.created_at
    limit greatest(1, least(coalesce(p_limite, 5), 20))
    for update of e skip locked
  ),
  prestadas as (
    update public.empresas e
    set clientify_sync_proximo_at = now() + interval '10 minutes'
    from elegidas x
    where e.id = x.id
    returning e.*
  )
  select p.id, a.codigo_aliado, p.empresa, p.sector, p.subsector, p.ciudad, p.nombre_contacto, p.cargo,
         p.telefono, p.correo, p.valor_factura, p.observaciones, p.es_perfecto,
         p.clientify_company_id, p.clientify_contact_id,
         f.storage_path, f.nombre_archivo, f.tipo_documento, f.clientify_subida_at is not null,
         p.clientify_sync_intentos
  from prestadas p
  join public.aliados a on a.id = p.aliado_id
  left join public.facturas f on f.id = p.factura_id;
$$;

-- Guarda lo avanzado aunque haya error (IDs ya creados en Clientify), para no duplicar al reintentar.
create function public.clientify_registrar_resultado_empresa(
  p_empresa uuid, p_company_id text, p_contact_id text, p_factura_subida boolean default false, p_error text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_error is null and (nullif(btrim(p_company_id), '') is null or nullif(btrim(p_contact_id), '') is null) then
    raise exception 'Se requieren los IDs de empresa y contacto de Clientify para registrar un éxito';
  end if;

  if p_factura_subida then
    update public.facturas f set clientify_subida_at = coalesce(f.clientify_subida_at, now())
    where f.empresa_id = p_empresa;
  end if;

  if p_error is null then
    update public.empresas e
    set clientify_company_id      = p_company_id,
        clientify_contact_id      = p_contact_id,
        clientify_sync_estado     = 'ok',
        clientify_sync_error      = null,
        clientify_sync_intentos   = 0,
        clientify_sync_proximo_at = null,
        clientify_sync_at         = now()
    where e.id = p_empresa;
  else
    update public.empresas e
    set clientify_company_id      = coalesce(nullif(btrim(p_company_id), ''), e.clientify_company_id),
        clientify_contact_id      = coalesce(nullif(btrim(p_contact_id), ''), e.clientify_contact_id),
        clientify_sync_estado     = 'error',
        clientify_sync_error      = left(p_error, 500),
        clientify_sync_intentos   = e.clientify_sync_intentos + 1,
        clientify_sync_proximo_at = now() + least(interval '15 minutes' * power(2, least(e.clientify_sync_intentos, 10)), interval '24 hours')
    where e.id = p_empresa;
  end if;
end;
$$;

revoke execute on function public.registrar_oportunidad(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.clientify_reclamar_empresas(integer, uuid) from public, anon, authenticated;
revoke execute on function public.clientify_registrar_resultado_empresa(uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.registrar_oportunidad(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.clientify_reclamar_empresas(integer, uuid) to service_role;
grant execute on function public.clientify_registrar_resultado_empresa(uuid, text, text, boolean, text) to service_role;
