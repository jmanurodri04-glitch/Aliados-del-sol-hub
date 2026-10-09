-- Fase 1 · 01 — Extensiones, esquema interno, enums y utilidades comunes.
-- Ver CLAUDE.md §4 (modelo de datos) y §6.3 (niveles).

create extension if not exists pgcrypto with schema extensions;

-- Esquema no expuesto por la API de Supabase (solo `public` lo está).
-- Aquí viven los helpers que usan las políticas RLS y los triggers.
create schema if not exists interno;
revoke all on schema interno from public, anon;
grant usage on schema interno to authenticated, service_role;

create type public.tipo_aliado as enum (
  'financiero',
  'emi',
  'linker',
  'cliente_embajador',
  'agremiaciones'
);

-- Ordenado de menor a mayor: permite comparar `nivel >= nivel_requerido`.
create type public.nivel as enum (
  'bronce',
  'plata',
  'oro',
  'platino',
  'diamante',
  'circulo_solar'
);

create type public.estado_triple as enum ('si', 'no', 'revision');

-- Trigger genérico para mantener `updated_at`.
create function interno.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
