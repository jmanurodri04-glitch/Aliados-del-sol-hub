-- Fase 3 · 02 — Índice que cubre la FK movimientos_puntos.motivo → reglas_puntos.
-- También sirve para contar movimientos por motivo y fecha (p. ej. el tope mensual de módulos, §5.3).

create index movimientos_puntos_motivo_idx on public.movimientos_puntos (motivo, aliado_id, fecha);
