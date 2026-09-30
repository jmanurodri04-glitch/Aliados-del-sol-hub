-- Fase 4 · 02 — Programación de la sincronización aliado → Clientify cada 15 minutos (CLAUDE.md §8, flujo A).
--
-- Se programa desde Supabase (pg_cron + pg_net) porque funciona en cualquier plan de Vercel: en Hobby,
-- Vercel Cron solo permite una ejecución diaria (esa queda como respaldo en vercel.json).
--
-- La URL del endpoint y el CRON_SECRET se guardan en el Vault de cada proyecto, NUNCA en el código:
--   select vault.create_secret('https://<dominio>/api/cron/clientify-aliados', 'clientify_sync_url');
--   select vault.create_secret('<mismo valor que CRON_SECRET en Vercel>', 'cron_secret');
--   -- Opcional, solo si el despliegue tiene Deployment Protection (p. ej. un Preview):
--   select vault.create_secret('<Protection Bypass for Automation>', 'vercel_bypass_secret');
-- Mientras no existan esos secretos, el job no hace nada.

create extension if not exists pg_net with schema extensions;

create function interno.invocar_sincronizacion_clientify()
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
  select s.decrypted_secret into v_url     from vault.decrypted_secrets s where s.name = 'clientify_sync_url';
  select s.decrypted_secret into v_secreto from vault.decrypted_secrets s where s.name = 'cron_secret';
  select s.decrypted_secret into v_bypass  from vault.decrypted_secrets s where s.name = 'vercel_bypass_secret';

  if v_url is null or v_secreto is null then
    return null; -- sin configurar en este proyecto: no se llama a nada
  end if;

  v_headers := jsonb_build_object('Authorization', 'Bearer ' || v_secreto);
  if v_bypass is not null then
    v_headers := v_headers || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;

  -- Asíncrono: pg_net hace la solicitud en segundo plano y devuelve el id de la solicitud.
  return net.http_get(url := v_url, headers := v_headers, timeout_milliseconds := 60000);
end;
$$;

revoke execute on function interno.invocar_sincronizacion_clientify() from public, anon, authenticated;

select cron.schedule('sincronizar-clientify-aliados', '*/15 * * * *', 'select interno.invocar_sincronizacion_clientify()');
