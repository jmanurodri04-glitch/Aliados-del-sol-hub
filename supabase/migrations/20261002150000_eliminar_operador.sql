-- Fase 11 · 02 — Eliminar operadores desde el panel (pedido en la prueba real con celulares).
--
-- Un operador invitado por error (correo equivocado, persona que no era) se puede eliminar si aún no registró canjes.
-- Si ya registró alguno, solo se desactiva: los canjes conservan quién los registró (auditoría).
-- La base borra la fila de `operadores` y deja la acción en acciones_admin; POST /api/admin borra además la cuenta de
-- acceso (auth.users) cuando era solo de operador. Si la persona también es aliado, conserva su cuenta de aliado.

alter table public.acciones_admin
  drop constraint acciones_admin_accion_check,
  add constraint acciones_admin_accion_check check (accion in (
    'aprobar_aliado', 'rechazar_aliado', 'suspender_aliado', 'reactivar_aliado',
    'ajuste_puntos', 'baja_calidad', 'validar_evento', 'rechazar_evento', 'resolver_conflicto',
    'anular_canje', 'guardar_recompensa', 'invitar_operador', 'estado_operador', 'eliminar_operador'));

-- Devuelve `borrar_usuario`: el id de la cuenta de acceso que el servidor debe borrar (solo si no es de un aliado).
create function public.admin_eliminar_operador(p_admin uuid, p_operador uuid, p_motivo text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_admin  text := interno.exigir_admin(p_admin);
  v_motivo text := interno.texto_obligatorio(p_motivo, 'el motivo', 5);
  v_op     public.operadores%rowtype;
  v_canjes integer;
begin
  select * into v_op from public.operadores o where o.id = p_operador for update;
  if not found then
    raise exception 'operador_inexistente: el operador no existe';
  end if;
  select count(*) into v_canjes from public.canjes c where v_op.usuario_id is not null and c.registrado_por = v_op.usuario_id;
  if v_canjes > 0 then
    raise exception 'estado_invalido: % ya registró % canje(s); desactívalo para conservar el historial', v_op.correo, v_canjes;
  end if;

  delete from public.operadores o where o.id = p_operador;

  perform interno.registrar_accion_admin(p_admin, v_admin, 'eliminar_operador', null, null, 'operador:' || p_operador,
    jsonb_build_object('correo', v_op.correo, 'nombre', v_op.nombre, 'proveedor', v_op.proveedor, 'motivo', v_motivo));
  return jsonb_build_object('operador_id', p_operador, 'correo', v_op.correo,
    'borrar_usuario', case when v_op.usuario_id is not null
                            and not exists (select 1 from public.aliados a where a.id = v_op.usuario_id)
                           then v_op.usuario_id end);
end;
$$;

revoke execute on function public.admin_eliminar_operador(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_eliminar_operador(uuid, uuid, text) to service_role;
