-- Conciliación de los referidos cerrados (decisión del equipo, oct 2026; CLAUDE.md §8, flujo C).
-- La conciliación horaria solo vuelve a leer los referidos en curso (negocio_cerrado <> 'si'). Un referido
-- cerrado al que solo le cambian el contacto (una etiqueta de información falsa o un retroceso de Status) no se
-- volvía a leer hasta que se moviera su oportunidad. Ahora, una vez al día (la corrida de las 02:00 Bogotá), la
-- conciliación incluye también los cerrados.
-- Se agrega una versión con el parámetro y la de siempre, sin parámetro, la llama con `false` (sin borrar nada).

create function public.clientify_encolar_conciliacion(p_incluir_cerrados boolean)
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
    and (p_incluir_cerrados or a.negocio_cerrado <> 'si')
  on conflict (entidad, entidad_id) do nothing;
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

create or replace function public.clientify_encolar_conciliacion()
returns integer
language sql
set search_path = ''
as $$
  select public.clientify_encolar_conciliacion(false);
$$;

revoke execute on function public.clientify_encolar_conciliacion(boolean) from public, anon, authenticated;
grant execute on function public.clientify_encolar_conciliacion(boolean) to service_role;
