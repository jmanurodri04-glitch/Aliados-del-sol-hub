-- Fase 6 · 01 — Webhook de Clientify (flujo C), aplicación del avance y conciliación (CLAUDE.md §5.1, §7.1, §8).
--
-- POST /api/webhooks/clientify guarda el evento crudo y encola la entidad (contacto u oportunidad).
-- El cron /api/cron/clientify vuelve a consultar Clientify, deriva las variables (lib/clientify/avance.js) y
-- llama a public.aplicar_avance_clientify, que en una transacción guarda los datos crudos, aplica la regla
-- "el primer valor definitivo gana" e inserta los movimientos con su clave única.

-- Empresas del formulario público (§7.1) ------------------------------------------------------------
-- El formulario de Clientify puede no traer sector, valor de la factura, teléfono, correo o empresa.
-- Siguen siendo obligatorios para lo que se registra en el Hub.

alter table public.empresas
  alter column empresa drop not null,
  alter column sector drop not null,
  alter column telefono drop not null,
  alter column correo drop not null,
  alter column valor_factura drop not null,
  add constraint empresas_campos_hub check (
    origen <> 'hub'
    or (empresa is not null and sector is not null and telefono is not null and correo is not null and valor_factura is not null)
  );

-- Eventos y cola ------------------------------------------------------------------------------------

alter table public.webhook_eventos
  add column entidad    text check (entidad in ('contacto', 'oportunidad')),
  add column entidad_id text,
  add column accion     text;

create index webhook_eventos_entidad_idx on public.webhook_eventos (entidad, entidad_id)
  where procesado_at is null;

-- Una fila por entidad: varios eventos del mismo contacto se procesan una sola vez, porque el proceso
-- siempre vuelve a consultar el estado actual en Clientify.
create table public.clientify_cola_entidades (
  entidad        text not null check (entidad in ('contacto', 'oportunidad')),
  entidad_id     text not null check (entidad_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  origen         text not null default 'webhook' check (origen in ('webhook', 'conciliacion')),
  programado_at  timestamptz not null default now(),
  intentos       integer not null default 0 check (intentos >= 0),
  error          text,
  actualizado_at timestamptz not null default now(),
  primary key (entidad, entidad_id)
);

comment on table public.clientify_cola_entidades is 'Contactos y oportunidades de Clientify por reprocesar (webhook o conciliación).';
create index clientify_cola_entidades_programado_idx on public.clientify_cola_entidades (programado_at);

alter table public.clientify_cola_entidades enable row level security;
revoke all on table public.clientify_cola_entidades from anon, authenticated;
grant all on table public.clientify_cola_entidades to service_role;

-- Conflictos: Clientify cambió un valor que ya era definitivo (§5.1). No cambia puntos ni calidad;
-- lo resuelve un admin con ajuste_admin (panel de la fase 9).
create table public.avance_conflictos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  variable         text not null,
  valor_hub        public.estado_triple not null,
  valor_clientify  public.estado_triple not null,
  detectado_at     timestamptz not null default now(),
  resuelto_at      timestamptz,
  resuelto_por     uuid references public.aliados (id),
  nota             text
);

comment on table public.avance_conflictos is 'Cambios de Clientify sobre valores ya definitivos; pendientes de revisión de un admin.';
create unique index avance_conflictos_abiertos_key on public.avance_conflictos (empresa_id, variable, valor_clientify)
  where resuelto_at is null;
create index avance_conflictos_resuelto_por_idx on public.avance_conflictos (resuelto_por) where resuelto_por is not null;

alter table public.avance_conflictos enable row level security;
revoke all on table public.avance_conflictos from anon, authenticated;
grant all on table public.avance_conflictos to service_role;
grant select on table public.avance_conflictos to authenticated;
create policy avance_conflictos_select on public.avance_conflictos
  for select to authenticated
  using ((select interno.es_admin()));

-- Recepción y cola ----------------------------------------------------------------------------------

create function public.clientify_encolar_entidad(
  p_entidad text, p_entidad_id text, p_demora_segundos integer default 0, p_origen text default 'webhook')
returns void
language sql
set search_path = ''
as $$
  insert into public.clientify_cola_entidades as c (entidad, entidad_id, origen, programado_at)
  values (p_entidad, p_entidad_id, p_origen, now() + make_interval(secs => greatest(coalesce(p_demora_segundos, 0), 0)))
  on conflict (entidad, entidad_id) do update
    set programado_at  = excluded.programado_at,
        origen         = excluded.origen,
        intentos       = 0,
        error          = null,
        actualizado_at = now();
$$;

-- Guarda el evento crudo y encola la entidad. Si no se reconoció la entidad, el evento queda
-- cerrado con un error para revisión.
create function public.webhook_clientify_recibir(
  p_payload jsonb, p_entidad text, p_entidad_id text, p_accion text, p_demora_segundos integer default 0)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.webhook_eventos (fuente, payload, entidad, entidad_id, accion, procesado_at, error)
  values ('clientify', coalesce(p_payload, '{}'::jsonb), p_entidad, p_entidad_id, left(p_accion, 100),
          case when p_entidad is null or p_entidad_id is null then now() end,
          case when p_entidad is null or p_entidad_id is null then 'No se reconoció el contacto o la oportunidad del evento' end)
  returning id into v_id;

  if p_entidad is not null and p_entidad_id is not null then
    perform public.clientify_encolar_entidad(p_entidad, p_entidad_id, p_demora_segundos, 'webhook');
  end if;
  return v_id;
end;
$$;

create function public.clientify_reclamar_entidades(p_limite integer default 10)
returns table (entidad text, entidad_id text, origen text, intentos integer, reclamado_at timestamptz)
language sql
set search_path = ''
as $$
  with elegidas as (
    select c.entidad as ent, c.entidad_id as ent_id
    from public.clientify_cola_entidades c
    where c.programado_at <= now()
    order by c.programado_at
    limit greatest(1, least(coalesce(p_limite, 10), 50))
    for update of c skip locked
  ),
  prestadas as (
    update public.clientify_cola_entidades c
    set programado_at = now() + interval '5 minutes'
    from elegidas e
    where c.entidad = e.ent and c.entidad_id = e.ent_id
    returning c.entidad as ent, c.entidad_id as ent_id, c.origen as org, c.intentos as n
  )
  select p.ent, p.ent_id, p.org, p.n, now() from prestadas p;
$$;

-- p_error: falla que se reintenta (espera 2 min, 4, 8… máximo 6 h).
-- p_aviso: el proceso terminó pero hay algo que revisar (Status desconocido, ID_aliado inexistente…).
create function public.clientify_resultado_entidad(
  p_entidad text, p_entidad_id text, p_reclamado_at timestamptz, p_error text default null, p_aviso text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_error is null then
    -- Si llegó otro evento mientras se procesaba, la fila se conserva para procesarlo.
    delete from public.clientify_cola_entidades c
    where c.entidad = p_entidad and c.entidad_id = p_entidad_id and c.actualizado_at <= p_reclamado_at;
  else
    update public.clientify_cola_entidades c
    set intentos      = c.intentos + 1,
        error         = left(p_error, 500),
        programado_at = now() + least(interval '2 minutes' * power(2, least(c.intentos, 12)), interval '6 hours')
    where c.entidad = p_entidad and c.entidad_id = p_entidad_id;
  end if;

  update public.webhook_eventos w
  set procesado_at = case when p_error is null then now() else w.procesado_at end,
      error        = left(coalesce(p_error, p_aviso), 1000)
  where w.entidad = p_entidad and w.entidad_id = p_entidad_id
    and w.procesado_at is null and w.recibido_at <= p_reclamado_at;
end;
$$;

-- Leads del formulario público "Refiere tu empresa" (§7.1) -------------------------------------------
-- Errores con prefijo estable (el proceso los registra como aviso y no reintenta):
--   aliado_inexistente · referido_duplicado
create function public.clientify_registrar_lead(p_codigo_aliado text, p_contact_id text, p_datos jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_aliado  public.aliados%rowtype;
  v_empresa public.empresas%rowtype;
  v_correo  text := lower(nullif(btrim(p_datos ->> 'correo'), ''));
  v_valor   numeric;
begin
  select * into v_empresa from public.empresas e where e.clientify_contact_id = p_contact_id;
  if found then
    return jsonb_build_object('empresa_id', v_empresa.id, 'creada', false);
  end if;

  select * into v_aliado from public.aliados a where a.codigo_aliado = upper(btrim(coalesce(p_codigo_aliado, '')));
  if not found then
    raise exception 'aliado_inexistente: el ID_aliado "%" no corresponde a ningún aliado', left(coalesce(p_codigo_aliado, ''), 40);
  end if;

  -- Deduplicación (§8, flujo B): el contacto puede ser un referido del Hub que aún no tiene el ID de Clientify.
  if v_correo is not null then
    select * into v_empresa from public.empresas e where lower(e.correo) = v_correo for update;
    if found then
      if v_empresa.aliado_id <> v_aliado.id then
        raise exception 'referido_duplicado: el contacto ya fue referido por otro aliado';
      end if;
      if v_empresa.clientify_contact_id is not null then
        raise exception 'referido_duplicado: el correo ya está vinculado a otro contacto de Clientify';
      end if;
      update public.empresas e set clientify_contact_id = p_contact_id where e.id = v_empresa.id;
      return jsonb_build_object('empresa_id', v_empresa.id, 'creada', false, 'vinculada', true);
    end if;
  end if;

  begin
    v_valor := nullif(p_datos ->> 'valor_factura', '')::numeric;
  exception when others then
    v_valor := null;
  end;

  insert into public.empresas (aliado_id, origen, empresa, sector, subsector, ciudad, nombre_contacto, cargo,
                               telefono, correo, valor_factura, es_perfecto, clientify_contact_id, clientify_sync_estado)
  values (v_aliado.id, 'clientify_form',
          left(nullif(btrim(p_datos ->> 'empresa'), ''), 200),
          left(nullif(btrim(p_datos ->> 'sector'), ''), 200),
          left(nullif(btrim(p_datos ->> 'subsector'), ''), 200),
          left(nullif(btrim(p_datos ->> 'ciudad'), ''), 200),
          left(coalesce(nullif(btrim(p_datos ->> 'nombre_contacto'), ''), 'Sin nombre'), 200),
          left(nullif(btrim(p_datos ->> 'cargo'), ''), 200),
          left(nullif(btrim(p_datos ->> 'telefono'), ''), 30),
          v_correo,
          case when v_valor >= 0 then v_valor end,
          coalesce((p_datos ->> 'es_perfecto')::boolean, false),
          p_contact_id, 'ok')
  returning * into v_empresa;

  -- perfecto queda en 'revision': lo define la etiqueta del contacto al aplicar el avance.
  insert into public.avance_empresa (empresa_id) values (v_empresa.id);

  -- +10 por registro válido. Si el aliado no está activo, el libro mayor lo retiene (§4.7).
  insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por)
  select v_aliado.id, r.tipo, r.motivo, 'empresas', v_empresa.id::text,
         'empresa:' || v_empresa.id || ':registro_valido', 'webhook_clientify'
  from public.reglas_puntos r where r.motivo = 'registro_valido'
  on conflict (clave_unica) do nothing;

  return jsonb_build_object('empresa_id', v_empresa.id, 'creada', true);
end;
$$;

-- Aplicación del avance (§5.1, §8) --------------------------------------------------------------------
-- p_crudos: datos crudos de Clientify (solo se actualizan las claves presentes).
-- p_variables: variables derivadas ('si' | 'no' | 'revision'); 'revision' nunca cambia nada.
create function public.aplicar_avance_clientify(p_empresa uuid, p_crudos jsonb, p_variables jsonb, p_deal_id text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  -- Orden de los movimientos (§8): calificado → perfecto → fuera_perfil → oportunidad_tecnica → propuesta → cierre → información falsa.
  c_orden      constant text[] := array['calificado', 'perfecto', 'fuera_perfil', 'oportunidad_tecnica',
                                        'propuesta_comercial', 'negocio_cerrado', 'informacion_falsa', 'integridad_informacion'];
  v_empresa    public.empresas%rowtype;
  v_avance     jsonb;
  v_var        text;
  v_nuevo      public.estado_triple;
  v_actual     public.estado_triple;
  v_aplicados  jsonb := '{}'::jsonb;
  v_conflictos jsonb := '[]'::jsonb;
  v_movs       jsonb := '[]'::jsonb;
  v_motivo     text;
  v_insertado  integer;
  c            jsonb := coalesce(p_crudos, '{}'::jsonb);
begin
  select * into v_empresa from public.empresas e where e.id = p_empresa;
  if not found then
    raise exception 'empresa_inexistente: %', p_empresa;
  end if;

  insert into public.avance_empresa (empresa_id) values (p_empresa) on conflict (empresa_id) do nothing;
  select to_jsonb(a) into v_avance from public.avance_empresa a where a.empresa_id = p_empresa for update;

  -- 1. Qué cambia: solo el paso de 'revision' a un valor definitivo. Un cambio sobre un valor
  --    definitivo es un conflicto (no cambia puntos ni calidad).
  foreach v_var in array c_orden loop
    continue when not (coalesce(p_variables, '{}'::jsonb) ? v_var);
    v_nuevo  := (p_variables ->> v_var)::public.estado_triple;
    v_actual := (v_avance ->> v_var)::public.estado_triple;
    continue when v_nuevo = 'revision' or v_nuevo = v_actual;

    if v_actual <> 'revision' then
      insert into public.avance_conflictos (empresa_id, variable, valor_hub, valor_clientify)
      values (p_empresa, v_var, v_actual, v_nuevo)
      on conflict (empresa_id, variable, valor_clientify) where resuelto_at is null do nothing;
      v_conflictos := v_conflictos || jsonb_build_object('variable', v_var, 'hub', v_actual, 'clientify', v_nuevo);
    else
      v_aplicados := v_aplicados || jsonb_build_object(v_var, v_nuevo);
    end if;
  end loop;

  -- 2. Datos crudos y variables (la fecha de calificación va antes del movimiento, §5.2).
  update public.avance_empresa a set
    calificado             = coalesce((v_aplicados ->> 'calificado')::public.estado_triple, a.calificado),
    perfecto               = coalesce((v_aplicados ->> 'perfecto')::public.estado_triple, a.perfecto),
    fuera_perfil           = coalesce((v_aplicados ->> 'fuera_perfil')::public.estado_triple, a.fuera_perfil),
    oportunidad_tecnica    = coalesce((v_aplicados ->> 'oportunidad_tecnica')::public.estado_triple, a.oportunidad_tecnica),
    propuesta_comercial    = coalesce((v_aplicados ->> 'propuesta_comercial')::public.estado_triple, a.propuesta_comercial),
    negocio_cerrado        = coalesce((v_aplicados ->> 'negocio_cerrado')::public.estado_triple, a.negocio_cerrado),
    informacion_falsa      = coalesce((v_aplicados ->> 'informacion_falsa')::public.estado_triple, a.informacion_falsa),
    integridad_informacion = coalesce((v_aplicados ->> 'integridad_informacion')::public.estado_triple, a.integridad_informacion),
    fecha_calificado       = case when v_aplicados ->> 'calificado' = 'si' then now() else a.fecha_calificado end,
    estado_contacto_clientify = case when c ? 'estado_contacto_clientify' then left(c ->> 'estado_contacto_clientify', 200) else a.estado_contacto_clientify end,
    fase_oportunidad       = case when c ? 'fase_oportunidad' then left(c ->> 'fase_oportunidad', 200) else a.fase_oportunidad end,
    fase_oportunidad_num   = case when c ? 'fase_oportunidad_num' then (c ->> 'fase_oportunidad_num')::integer else a.fase_oportunidad_num end,
    estado_oportunidad     = case when c ? 'estado_oportunidad' then c ->> 'estado_oportunidad' else a.estado_oportunidad end,
    lead_scoring           = case when c ? 'lead_scoring' then (c ->> 'lead_scoring')::numeric else a.lead_scoring end,
    valor_oportunidad      = case when c ? 'valor_oportunidad' then (c ->> 'valor_oportunidad')::numeric else a.valor_oportunidad end,
    valor_cotizado         = case when c ? 'valor_cotizado' then (c ->> 'valor_cotizado')::numeric else a.valor_cotizado end,
    potencia_instalada_kwp = case when c ? 'potencia_instalada_kwp' then (c ->> 'potencia_instalada_kwp')::numeric else a.potencia_instalada_kwp end,
    clientify_updated_at   = now()
  where a.empresa_id = p_empresa;

  if p_deal_id is not null and p_deal_id is distinct from v_empresa.clientify_deal_id then
    update public.empresas e set clientify_deal_id = p_deal_id where e.id = p_empresa;
  end if;

  -- 3. Movimientos, en orden y con su clave única: los repetidos no hacen nada (§5.1).
  foreach v_var in array c_orden loop
    continue when not (v_aplicados ? v_var);
    v_motivo := case v_var || ':' || (v_aplicados ->> v_var)
      when 'calificado:si'          then 'empresa_calificada'
      when 'calificado:no'          then 'referido_no_calificado'
      when 'perfecto:si'            then 'referido_perfecto'
      when 'perfecto:no'            then 'referido_imperfecto'
      when 'fuera_perfil:si'        then 'fuera_perfil'
      when 'oportunidad_tecnica:si' then 'evaluacion_tecnica'
      when 'propuesta_comercial:si' then 'propuesta_comercial'
      when 'negocio_cerrado:si'     then 'negocio_cerrado'
      when 'informacion_falsa:si'   then 'informacion_falsa'
    end;
    continue when v_motivo is null;

    insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por)
    select v_empresa.aliado_id, r.tipo, r.motivo, 'empresas', p_empresa::text,
           'empresa:' || p_empresa || ':' || v_var, 'webhook_clientify'
    from public.reglas_puntos r where r.motivo = v_motivo
    on conflict (clave_unica) do nothing;
    get diagnostics v_insertado = row_count;
    v_movs := v_movs || jsonb_build_object('motivo', v_motivo, 'registrado', v_insertado > 0);
  end loop;

  return jsonb_build_object('aplicados', v_aplicados, 'movimientos', v_movs, 'conflictos', v_conflictos);
end;
$$;

-- Conciliación nocturna (§8): reprocesa los referidos que siguen en curso. Es idempotente.
create function public.clientify_encolar_conciliacion()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
begin
  insert into public.clientify_cola_entidades (entidad, entidad_id, origen, programado_at)
  select 'contacto', e.clientify_contact_id, 'conciliacion', now()
  from public.empresas e
  join public.avance_empresa a on a.empresa_id = e.id
  where e.clientify_contact_id is not null
    and a.negocio_cerrado <> 'si'
  on conflict (entidad, entidad_id) do nothing;
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- Privacidad: el payload crudo se vacía a los 90 días (decisión del equipo). -----------------------------
create function interno.depurar_webhooks_clientify()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  update public.webhook_eventos w
  set payload = '{"depurado": true}'::jsonb
  where w.recibido_at < now() - interval '90 days'
    and w.payload is distinct from '{"depurado": true}'::jsonb;
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- Llamar a otro endpoint /api/cron/* del mismo despliegue que guarda el Vault (p. ej. el diagnóstico):
--   select interno.invocar_cron_hub('clientify-diagnostico');
create function interno.invocar_cron_hub(p_endpoint text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url     text;
  v_secreto text;
  v_bypass  text;
  v_headers jsonb;
begin
  if p_endpoint !~ '^[a-z0-9-]+$' then
    raise exception 'Endpoint inválido: %', p_endpoint;
  end if;
  select s.decrypted_secret into v_url     from vault.decrypted_secrets s where s.name = 'clientify_sync_url';
  select s.decrypted_secret into v_secreto from vault.decrypted_secrets s where s.name = 'cron_secret';
  select s.decrypted_secret into v_bypass  from vault.decrypted_secrets s where s.name = 'vercel_bypass_secret';
  if v_url is null or v_secreto is null then
    return null;
  end if;

  v_headers := jsonb_build_object('Authorization', 'Bearer ' || v_secreto);
  if v_bypass is not null then
    v_headers := v_headers || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;
  return net.http_get(url := regexp_replace(v_url, '/api/cron/.*$', '/api/cron/' || p_endpoint),
                      headers := v_headers, timeout_milliseconds := 60000);
end;
$$;

-- Privilegios ---------------------------------------------------------------------------------------

revoke execute on function public.clientify_encolar_entidad(text, text, integer, text) from public, anon, authenticated;
revoke execute on function public.webhook_clientify_recibir(jsonb, text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.clientify_reclamar_entidades(integer) from public, anon, authenticated;
revoke execute on function public.clientify_resultado_entidad(text, text, timestamptz, text, text) from public, anon, authenticated;
revoke execute on function public.clientify_registrar_lead(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.aplicar_avance_clientify(uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.clientify_encolar_conciliacion() from public, anon, authenticated;
revoke execute on function interno.depurar_webhooks_clientify() from public, anon, authenticated;
revoke execute on function interno.invocar_cron_hub(text) from public, anon, authenticated;

grant execute on function public.clientify_encolar_entidad(text, text, integer, text) to service_role;
grant execute on function public.webhook_clientify_recibir(jsonb, text, text, text, integer) to service_role;
grant execute on function public.clientify_reclamar_entidades(integer) to service_role;
grant execute on function public.clientify_resultado_entidad(text, text, timestamptz, text, text) to service_role;
grant execute on function public.clientify_registrar_lead(text, text, jsonb) to service_role;
grant execute on function public.aplicar_avance_clientify(uuid, jsonb, jsonb, text) to service_role;
grant execute on function public.clientify_encolar_conciliacion() to service_role;

-- Programación --------------------------------------------------------------------------------------
-- El mismo job procesa ahora las tres colas (aliados, oportunidades y eventos del webhook): cada 2 minutos.
select cron.schedule('sincronizar-clientify-aliados', '*/2 * * * *', 'select interno.invocar_sincronizacion_clientify()');
-- Día 1 de cada mes a las 03:30 Bogotá (08:30 UTC).
select cron.schedule('depurar-webhooks-clientify', '30 8 1 * *', 'select interno.depurar_webhooks_clientify()');
