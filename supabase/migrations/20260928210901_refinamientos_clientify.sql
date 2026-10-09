-- Fase 6 · 04 — Refinamientos con el proceso real de Clientify (CLAUDE.md §7.1, §8, tablas A–D).
--
-- 1. El formulario público "Refiere tu negocio" pone la etiqueta "aliado del sol hub" en el REFERIDO, así que las
--    etiquetas no sirven para reconocer el contacto de un aliado: se reconoce por su ID en Clientify y, si el
--    correo del lead es el del propio aliado, se rechaza como autorreferido (igual que en el Hub).
-- 2. Valor cotizado y pipeline originado son SUMAS del "Importe" (amount) de las oportunidades del referido
--    (decisión del equipo): el cotizado suma todas; el pipeline originado, solo las que se cierran y se llevan a
--    cabo (ganadas o en "Contrato"); la potencia instalada suma la "Potencia (kWp)" de esas mismas. Se calculan en
--    el escaneo horario de oportunidades, que es el único que ve todas las oportunidades de cada contacto.

-- Errores con prefijo estable (el proceso los registra como aviso y no reintenta):
--   aliado_inexistente · referido_duplicado · autorreferido
create or replace function public.clientify_registrar_lead(p_codigo_aliado text, p_contact_id text, p_datos jsonb)
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

  -- El contacto del propio aliado (p. ej. uno que se refirió a sí mismo en el formulario) no es un referido.
  if v_correo is not null and v_correo = lower(v_aliado.correo) then
    raise exception 'autorreferido: el contacto es el mismo aliado';
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

-- p_valores: [{ contact_id, valor_cotizado, valor_oportunidad, potencia_instalada_kwp }] por contacto referido.
-- p_completo: el escaneo vio todas las oportunidades; los referidos que no aparecen quedan sin valores (null).
create function public.clientify_actualizar_valores(p_valores jsonb, p_completo boolean default true)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
begin
  with v as (
    select x.contact_id, x.valor_cotizado, x.valor_oportunidad, x.potencia_instalada_kwp
    from jsonb_to_recordset(coalesce(p_valores, '[]'::jsonb))
      as x(contact_id text, valor_cotizado numeric, valor_oportunidad numeric, potencia_instalada_kwp numeric)
  ),
  objetivo as (
    select e.id as empresa_id, v.valor_cotizado, v.valor_oportunidad, v.potencia_instalada_kwp
    from public.empresas e
    left join v on v.contact_id = e.clientify_contact_id
    where e.clientify_contact_id is not null
      and (v.contact_id is not null or p_completo)
  )
  update public.avance_empresa a
  set valor_cotizado         = o.valor_cotizado,
      valor_oportunidad      = o.valor_oportunidad,
      potencia_instalada_kwp = o.potencia_instalada_kwp
  from objetivo o
  where a.empresa_id = o.empresa_id
    and (a.valor_cotizado, a.valor_oportunidad, a.potencia_instalada_kwp)
        is distinct from (o.valor_cotizado, o.valor_oportunidad, o.potencia_instalada_kwp);
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

revoke execute on function public.clientify_actualizar_valores(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.clientify_actualizar_valores(jsonb, boolean) to service_role;
