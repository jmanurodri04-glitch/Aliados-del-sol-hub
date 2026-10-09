-- Aviso a n8n también de los referidos perfectos (decisión del equipo, oct 2026; CLAUDE.md §7.4).
--
-- La cola `avisos_n8n` recibe ahora todos los referidos nuevos del Hub, cada uno con su `tipo` ('perfecto' o
-- 'imperfecto'). El servidor envía cada tipo a su propio webhook de n8n (N8N_PERFECTOS_URL o N8N_IMPERFECTOS_URL), así
-- cada flujo de n8n solo recibe —y solo gasta ejecuciones en— los referidos que le corresponden.

alter table public.avisos_n8n
  add column tipo text not null default 'imperfecto' check (tipo in ('perfecto', 'imperfecto'));
comment on column public.avisos_n8n.tipo is 'Webhook de n8n al que va el aviso: perfecto o imperfecto (según empresas.es_perfecto al registrar).';
comment on table public.avisos_n8n is 'Aviso a n8n de cada referido nuevo del Hub, perfecto o imperfecto (solo el servidor escribe; un admin lee).';

create or replace function interno.encolar_aviso_n8n()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origen = 'hub' then
    insert into public.avisos_n8n (empresa_id, tipo)
    values (new.id, case when new.es_perfecto then 'perfecto' else 'imperfecto' end)
    on conflict (empresa_id) do nothing;
  end if;
  return null;
end;
$$;

-- El tipo se agrega al resultado (cambia la forma de la tabla devuelta, por eso se vuelve a crear).
drop function public.avisos_n8n_reclamar(integer, uuid);
create function public.avisos_n8n_reclamar(p_limite integer default 10, p_empresa uuid default null)
returns table (
  empresa_id           uuid,
  tipo                 text,
  empresa              text,
  ciudad               text,
  subsector            text,
  cargo                text,
  tiene_factura        boolean,
  nombre_contacto      text,
  telefono             text,
  correo               text,
  canal                text,
  registrado_at        timestamptz,
  clientify_contact_id text,
  codigo_aliado        text,
  intentos             integer
)
language sql
set search_path = ''
as $$
  with elegidas as (
    select v.empresa_id
    from public.avisos_n8n v
    join public.empresas e on e.id = v.empresa_id
    where v.estado in ('pendiente', 'error')
      and v.proximo_at <= now()
      and e.clientify_contact_id is not null
      and (p_empresa is null or v.empresa_id = p_empresa)
    order by v.proximo_at, v.created_at
    limit greatest(1, least(coalesce(p_limite, 10), 50))
    for update of v skip locked
  ),
  prestadas as (
    update public.avisos_n8n v
    set proximo_at = now() + interval '10 minutes'
    from elegidas x
    where v.empresa_id = x.empresa_id
    returning v.empresa_id, v.tipo, v.intentos
  )
  select e.id, p.tipo, e.empresa, e.ciudad, e.subsector, e.cargo, e.factura_id is not null, e.nombre_contacto, e.telefono,
         e.correo, e.canal, e.created_at, e.clientify_contact_id, a.codigo_aliado, p.intentos
  from prestadas p
  join public.empresas e on e.id = p.empresa_id
  join public.aliados a on a.id = e.aliado_id;
$$;
revoke execute on function public.avisos_n8n_reclamar(integer, uuid) from public, anon, authenticated;
grant execute on function public.avisos_n8n_reclamar(integer, uuid) to service_role;

create or replace view public.v_admin_avisos_n8n
with (security_invoker = true)
as
select v.empresa_id, e.empresa, a.codigo_aliado, a.nombre_completo, v.estado, v.intentos,
       coalesce(v.error, case when e.clientify_contact_id is null then 'Esperando que el referido llegue a Clientify' end) as error,
       v.created_at, v.updated_at,
       case when v.proximo_at = 'infinity'::timestamptz then null else v.proximo_at end as proximo_at,
       v.tipo
from public.avisos_n8n v
join public.empresas e on e.id = v.empresa_id
join public.aliados a on a.id = e.aliado_id
where (select interno.es_admin())
  and (v.estado = 'error' or (v.estado = 'pendiente' and v.created_at < now() - interval '30 minutes'));
