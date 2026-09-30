-- Fase 6 · 03 — Ajustes por decisiones del equipo (CLAUDE.md §4.11, §8, flujo C).
--
-- 1. Los eventos que no son del programa (contactos u oportunidades ajenos) no se guardan: al procesarlos como
--    "ignorado" se borra su payload enseguida (antes se conservaba 90 días).
-- 2. El webhook de contactos de Clientify alimenta un flujo de n8n y no se cambia: solo llega el de oportunidades.
--    Para que los cambios de Status y etiquetas de los referidos lleguen igual, la conciliación (que vuelve a
--    consultar los contactos en curso y escanea las oportunidades) corre cada hora en lugar del escaneo solo.

drop function public.clientify_resultado_entidad(text, text, timestamptz, text, text);

-- p_error: falla que se reintenta (espera 2 min, 4, 8… máximo 6 h).
-- p_aviso: el proceso terminó pero hay algo que revisar (Status desconocido, ID_aliado inexistente…).
-- p_descartar: la entidad no es del programa; se borra el payload de sus eventos.
create function public.clientify_resultado_entidad(
  p_entidad text, p_entidad_id text, p_reclamado_at timestamptz, p_error text default null, p_aviso text default null,
  p_descartar boolean default false)
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
      error        = left(coalesce(p_error, p_aviso), 1000),
      payload      = case when p_error is null and p_descartar then '{"descartado": true}'::jsonb else w.payload end
  where w.entidad = p_entidad and w.entidad_id = p_entidad_id
    and w.procesado_at is null and w.recibido_at <= p_reclamado_at;
end;
$$;

revoke execute on function public.clientify_resultado_entidad(text, text, timestamptz, text, text, boolean) from public, anon, authenticated;
grant execute on function public.clientify_resultado_entidad(text, text, timestamptz, text, text, boolean) to service_role;

select cron.unschedule('escanear-oportunidades-clientify');
-- Cada hora, minuto 7.
select cron.schedule('conciliar-clientify', '7 * * * *', $$select interno.invocar_cron_hub('clientify-conciliacion')$$);
