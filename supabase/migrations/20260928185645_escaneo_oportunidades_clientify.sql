-- Fase 6 · 02 — Escaneo horario de oportunidades de Clientify (CLAUDE.md §8, flujo C).
--
-- El diagnóstico mostró que la API no filtra oportunidades por contacto (`/deals/?contact=` devuelve todas) y el
-- webhook de oportunidades puede no estar disponible en el plan de Clientify. Cada hora, /api/cron/clientify-oportunidades
-- revisa las oportunidades de los embudos del programa y encola las de referidos que son nuevas o cambiaron.
-- Usa la URL y el CRON_SECRET del Vault (interno.invocar_cron_hub); sin ellos no hace nada.

select cron.schedule('escanear-oportunidades-clientify', '7 * * * *', $$select interno.invocar_cron_hub('clientify-oportunidades')$$);
