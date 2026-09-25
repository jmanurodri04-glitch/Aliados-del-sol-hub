-- Fase 1 · 07 — Índice que cubre la FK compuesta empresas (factura_id, id) → facturas (id, empresa_id).
-- Reemplaza el índice parcial sobre factura_id, que el linter de Supabase no reconoce como cobertura.

drop index public.empresas_factura_id_idx;
create index empresas_factura_id_idx on public.empresas (factura_id, id);
