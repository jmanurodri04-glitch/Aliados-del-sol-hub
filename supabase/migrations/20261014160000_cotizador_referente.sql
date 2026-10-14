-- Cotizador Solar: quien refiere y correos de aliados (decisión del equipo, 14 oct 2026).
--
--   · El correo del paso 2 no puede ser el de un aliado (rol aliado, cualquier estado salvo rechazado): el contacto del
--     aliado en Clientify perdería su Tipo «Aliados Estratégicos». Los demás correos se aceptan.
--   · «Solicitar propuesta» lleva a Clientify el ID_aliado de quien refiere: el aliado de la sesión o, sin sesión, el
--     del correo opcional «Email de quien refiere» (aliado activo, pendiente o suspendido; si no existe, se ignora).
--   · Las tablas del cotizador siguen sin relación con las demás: el código solo se guarda mientras la propuesta
--     espera su envío a Clientify (lo necesita un reintento) y se borra al enviarla. No es una llave foránea.

alter table public.cotizador_residencial add column referente_codigo text check (referente_codigo ~ '^[A-Z0-9]{4,20}$');
alter table public.cotizador_comercial   add column referente_codigo text check (referente_codigo ~ '^[A-Z0-9]{4,20}$');
alter table public.cotizador_industrial  add column referente_codigo text check (referente_codigo ~ '^[A-Z0-9]{4,20}$');

-- ¿El correo es de un aliado? (paso 2 del cotizador).
create function public.cotizador_correo_es_aliado(p_correo text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.aliados a
    where lower(a.correo) = lower(trim(p_correo)) and a.rol = 'aliado' and a.estado <> 'rechazado');
$$;

-- Código del aliado que refiere, por su correo. NULL si no es de un aliado que pueda referir.
create function public.cotizador_codigo_referente(p_correo text)
returns text
language sql
stable
set search_path = ''
as $$
  select a.codigo_aliado from public.aliados a
  where lower(a.correo) = lower(trim(p_correo)) and a.rol = 'aliado' and a.estado in ('activo', 'pendiente', 'suspendido');
$$;

-- «Solicitar propuesta» con el código de quien refiere (se guarda solo la primera vez que se pide).
drop function public.cotizador_solicitar_propuesta(text, uuid);
create function public.cotizador_solicitar_propuesta(p_segmento text, p_id uuid, p_referente text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tabla  text := interno.cotizador_tabla(p_segmento);
  v_estado text;
  v_existe boolean;
begin
  execute format('select true, clientify_sync_estado from public.%I where id = $1 and created_at > now() - interval ''1 day'' for update', v_tabla)
    into v_existe, v_estado using p_id;
  if v_existe is null then
    raise exception 'simulacion_inexistente: la simulación no existe o ya venció';
  end if;
  if v_estado is null then
    execute format('update public.%I set propuesta_solicitada_at = now(), clientify_sync_estado = ''pendiente'', '
                   || 'clientify_sync_proximo_at = now(), referente_codigo = $2 where id = $1', v_tabla) using p_id, p_referente;
    v_estado := 'pendiente';
  end if;
  return jsonb_build_object('estado', v_estado);
end;
$$;

-- Resultado del envío: igual que antes, y al enviarse se borra el código de quien refiere.
create or replace function public.cotizador_resultado_propuesta(p_segmento text, p_id uuid, p_contact_id text, p_error text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'update public.%I c set '
    || '  clientify_sync_estado = case when $3 is null then ''ok'' else ''error'' end, '
    || '  clientify_contact_id  = coalesce($2, c.clientify_contact_id), '
    || '  clientify_sync_error  = left($3, 300), '
    || '  clientify_sync_at     = case when $3 is null then now() else c.clientify_sync_at end, '
    || '  clientify_sync_intentos = c.clientify_sync_intentos + case when $3 is null then 0 else 1 end, '
    || '  clientify_sync_proximo_at = case when $3 is null then null '
    || '    when c.clientify_sync_intentos + 1 >= 8 then ''infinity''::timestamptz '
    || '    else now() + least(interval ''15 minutes'' * power(2, c.clientify_sync_intentos), interval ''6 hours'') end, '
    || '  referente_codigo = case when $3 is null then null else c.referente_codigo end '
    || 'where c.id = $1 and c.clientify_sync_estado in (''pendiente'', ''error'')',
    interno.cotizador_tabla(p_segmento))
  using p_id, p_contact_id, p_error;
end;
$$;

revoke execute on function public.cotizador_correo_es_aliado(text) from public, anon, authenticated;
revoke execute on function public.cotizador_codigo_referente(text) from public, anon, authenticated;
revoke execute on function public.cotizador_solicitar_propuesta(text, uuid, text) from public, anon, authenticated;
grant execute on function public.cotizador_correo_es_aliado(text) to service_role;
grant execute on function public.cotizador_codigo_referente(text) to service_role;
grant execute on function public.cotizador_solicitar_propuesta(text, uuid, text) to service_role;
