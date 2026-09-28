-- Tests de la programación de la sincronización con Clientify (pg_cron + pg_net + Vault).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is((select schedule from cron.job where jobname = 'sincronizar-clientify-aliados'), '*/15 * * * *',
  'la sincronización se programa cada 15 minutos');

-- Sin secretos en el Vault: no se llama a nada ---------------------------------------------------

create temp table cola_antes as select count(*) as n from net.http_request_queue;
select is(interno.invocar_sincronizacion_clientify(), null, 'sin URL ni secreto configurados, no hace nada');
select is((select count(*) from net.http_request_queue), (select n from cola_antes), 'y no encola ninguna solicitud');

-- Con secretos: encola la llamada al endpoint con el CRON_SECRET ------------------------------------

select vault.create_secret('https://aliados.test/api/cron/clientify-aliados', 'clientify_sync_url');
select vault.create_secret('secreto-de-prueba', 'cron_secret');
create temp table solicitud as select interno.invocar_sincronizacion_clientify() as id;
select row_eq(
  $$select q.method::text, q.url, q.headers ->> 'Authorization' from net.http_request_queue q where q.id = (select id from solicitud)$$,
  row('GET'::text, 'https://aliados.test/api/cron/clientify-aliados'::text, 'Bearer secreto-de-prueba'::text),
  'encola un GET al endpoint con Authorization: Bearer <CRON_SECRET>'
);
select ok((select not (q.headers ? 'x-vercel-protection-bypass') from net.http_request_queue q where q.id = (select id from solicitud)),
  'sin secreto de bypass, no envía el encabezado de Vercel');

select vault.create_secret('bypass-de-prueba', 'vercel_bypass_secret');
create temp table solicitud_bypass as select interno.invocar_sincronizacion_clientify() as id;
select is(
  (select q.headers ->> 'x-vercel-protection-bypass' from net.http_request_queue q
   where q.id = (select id from solicitud_bypass)),
  'bypass-de-prueba', 'con secreto de bypass, lo envía para pasar la protección de un Preview');

select ok(not has_function_privilege('authenticated', 'interno.invocar_sincronizacion_clientify()', 'execute'),
  'el navegador no puede disparar la sincronización');

select * from finish();
rollback;
