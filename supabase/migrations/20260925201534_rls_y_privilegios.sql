-- Fase 1 · 06 — RLS y privilegios (CLAUDE.md §10).
--
-- Modelo:
--   * RLS activado en todas las tablas.
--   * `authenticated` solo puede LEER: sus propias filas, o todo si es admin.
--   * Ninguna escritura desde el cliente: se hacen desde /api con SUPABASE_SECRET_KEY
--     (service_role, que ignora RLS) o, en fases siguientes, con funciones SECURITY DEFINER.
--   * `anon` no tiene acceso a ninguna tabla.

-- ¿El usuario de la sesión es un admin activo? SECURITY DEFINER para evitar
-- recursión con la política de `aliados`. Vive en `interno`, que no expone la API.
create function interno.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.aliados a
    where a.id = (select auth.uid())
      and a.rol = 'admin'
      and a.estado = 'activo'
  );
$$;

revoke execute on function interno.es_admin() from public, anon;
grant execute on function interno.es_admin() to authenticated, service_role;

-- Privilegios base ---------------------------------------------------------------

do $$
declare
  t text;
  tablas text[] := array[
    'aliados', 'aliados_perfil_organizacion', 'aliados_perfil_alcance',
    'empresas', 'facturas', 'avance_empresa', 'movimientos_puntos',
    'eventos', 'modulos', 'modulos_completados', 'canjes', 'webhook_eventos'
  ];
begin
  foreach t in array tablas loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

-- `webhook_eventos` queda sin grants ni políticas para `authenticated`: solo el servidor.
grant select on table
  public.aliados,
  public.aliados_perfil_organizacion,
  public.aliados_perfil_alcance,
  public.empresas,
  public.facturas,
  public.avance_empresa,
  public.movimientos_puntos,
  public.eventos,
  public.modulos,
  public.modulos_completados,
  public.canjes
to authenticated;

-- Políticas de lectura --------------------------------------------------------------
-- Una sola política permisiva por tabla; auth.uid() y es_admin() van en subconsulta
-- para que Postgres los evalúe una vez por consulta y no por fila.

create policy aliados_select on public.aliados
  for select to authenticated
  using (id = (select auth.uid()) or (select interno.es_admin()));

create policy aliados_perfil_organizacion_select on public.aliados_perfil_organizacion
  for select to authenticated
  using (aliado_id = (select auth.uid()) or (select interno.es_admin()));

create policy aliados_perfil_alcance_select on public.aliados_perfil_alcance
  for select to authenticated
  using (aliado_id = (select auth.uid()) or (select interno.es_admin()));

create policy empresas_select on public.empresas
  for select to authenticated
  using (aliado_id = (select auth.uid()) or (select interno.es_admin()));

create policy facturas_select on public.facturas
  for select to authenticated
  using (aliado_id = (select auth.uid()) or (select interno.es_admin()));

create policy avance_empresa_select on public.avance_empresa
  for select to authenticated
  using (
    exists (
      select 1 from public.empresas e
      where e.id = avance_empresa.empresa_id
        and e.aliado_id = (select auth.uid())
    )
    or (select interno.es_admin())
  );

create policy movimientos_puntos_select on public.movimientos_puntos
  for select to authenticated
  using (aliado_id = (select auth.uid()) or (select interno.es_admin()));

create policy eventos_select on public.eventos
  for select to authenticated
  using (aliado_id = (select auth.uid()) or (select interno.es_admin()));

create policy modulos_select on public.modulos
  for select to authenticated
  using (activo or (select interno.es_admin()));

create policy modulos_completados_select on public.modulos_completados
  for select to authenticated
  using (aliado_id = (select auth.uid()) or (select interno.es_admin()));

create policy canjes_select on public.canjes
  for select to authenticated
  using (aliado_id = (select auth.uid()) or (select interno.es_admin()));
