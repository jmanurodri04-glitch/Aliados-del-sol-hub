-- Puntos de bienvenida (decisión del equipo, oct 2026; CLAUDE.md §5).
--
-- +10 Puntos Sol una sola vez, cuando GEENERA aprueba la cuenta (admin_aprobar_aliado), no al registrarse:
-- antes de la aprobación el aliado no entra al Hub y una solicitud rechazada no debe recibir puntos.
--   * clave única aliado:{id}:bienvenida → nunca se repite (suspender y reactivar, o rechazar y aprobar después);
--   * vinculo 'aliados' (nuevo), vinculo_id = id del aliado;
--   * las cuentas de admin no se aprueban por el panel (se asignan por SQL), así que no la reciben.
-- Los aliados que ya estaban activos la reciben en esta migración (decisión del equipo).

insert into public.reglas_puntos (motivo, tipo, puntos, descripcion)
values ('bienvenida', 'ganado', 10, 'Puntos de bienvenida');

alter table public.movimientos_puntos drop constraint movimientos_puntos_vinculo_check;
alter table public.movimientos_puntos add constraint movimientos_puntos_vinculo_check check (vinculo in (
  'empresas', 'eventos', 'modulos_completados', 'racha', 'canjes', 'ajuste_admin', 'aliados'
));

alter table public.movimientos_puntos drop constraint movimientos_puntos_motivo_tipo;
alter table public.movimientos_puntos add constraint movimientos_puntos_motivo_tipo check (
  (tipo = 'ganado' and motivo in ('registro_valido', 'referido_perfecto', 'empresa_calificada', 'evaluacion_tecnica',
    'propuesta_comercial', 'negocio_cerrado', 'modulo_completado', 'evento_validado', 'racha_solar', 'ajuste_admin', 'bienvenida'))
  or (tipo = 'perdido' and motivo in ('referido_imperfecto', 'referido_no_calificado', 'fuera_perfil', 'informacion_falsa',
    'baja_calidad_reiterada', 'ajuste_admin'))
  or (tipo = 'redimido' and motivo = 'canje')
);

-- Otorga la bienvenida a un aliado activo (idempotente). La usan la aprobación y esta migración.
create function interno.otorgar_bienvenida(p_aliado uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.movimientos_puntos (aliado_id, tipo, motivo, vinculo, vinculo_id, clave_unica, creado_por)
  select a.id, 'ganado', 'bienvenida', 'aliados', a.id::text, 'aliado:' || a.id || ':bienvenida', 'sistema'
  from public.aliados a
  where a.id = p_aliado and a.estado = 'activo' and a.rol = 'aliado'
  on conflict (clave_unica) do nothing;
$$;

revoke execute on function interno.otorgar_bienvenida(uuid) from public, anon, authenticated;

create or replace function public.admin_aprobar_aliado(p_admin uuid, p_codigo text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_aliado public.aliados := interno.aliado_por_codigo(p_codigo);
begin
  if v_aliado.estado not in ('pendiente', 'rechazado') then
    raise exception 'estado_invalido: solo se aprueba una solicitud pendiente o rechazada (estado actual: %)', v_aliado.estado;
  end if;
  update public.aliados a set estado = 'activo', aprobado_at = now(), aprobado_por = p_admin where a.id = v_aliado.id;
  perform interno.otorgar_bienvenida(v_aliado.id);
  perform interno.registrar_accion_admin(p_admin, v_admin, 'aprobar_aliado', v_aliado.id, v_aliado.codigo_aliado,
    null, jsonb_build_object('estado_anterior', v_aliado.estado));
  return jsonb_build_object('codigo_aliado', v_aliado.codigo_aliado, 'estado', 'activo');
end;
$$;

-- Aliados que ya estaban aprobados.
select interno.otorgar_bienvenida(a.id) from public.aliados a where a.estado = 'activo' and a.rol = 'aliado';
