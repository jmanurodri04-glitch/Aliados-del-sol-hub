-- Fase 1 · 03 — Empresas referidas, facturas y avance (CLAUDE.md §4.4–4.6, §6.1).

create table public.empresas (
  id                     uuid primary key default gen_random_uuid(),
  aliado_id              uuid not null references public.aliados (id) on delete cascade,
  origen                 text not null check (origen in ('hub', 'clientify_form')),
  empresa                text not null,
  sector                 text not null,
  subsector              text,
  ciudad                 text,
  nombre_contacto        text not null,
  cargo                  text,
  telefono               text not null,
  correo                 text not null,
  valor_factura          numeric not null check (valor_factura >= 0),
  observaciones          text,
  factura_id             uuid,               -- FK a facturas, se agrega abajo (referencia circular)
  es_perfecto            boolean not null,   -- calculado al guardar: los 10 campos, incluida la factura
  clientify_contact_id   text,
  clientify_company_id   text,
  clientify_deal_id      text,
  clientify_sync_estado  text not null default 'pendiente'
                         check (clientify_sync_estado in ('pendiente', 'ok', 'error')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Destino de las FK compuestas que garantizan que la factura sea del mismo aliado.
  constraint empresas_id_aliado_key unique (id, aliado_id)
);

create index empresas_aliado_id_idx on public.empresas (aliado_id, created_at desc);
create unique index empresas_clientify_contact_id_key on public.empresas (clientify_contact_id)
  where clientify_contact_id is not null;
create index empresas_clientify_deal_id_idx on public.empresas (clientify_deal_id)
  where clientify_deal_id is not null;
-- Deduplicación del flujo B (§8): mismo aliado + correo del contacto, creada hace poco.
create index empresas_dedupe_idx on public.empresas (aliado_id, lower(correo), created_at desc);

create trigger empresas_set_updated_at
  before update on public.empresas
  for each row execute function interno.set_updated_at();

create table public.facturas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null,
  aliado_id       uuid not null,
  tipo_documento  text not null check (tipo_documento in ('pdf', 'jpg', 'png')),
  storage_path    text not null unique,   -- bucket privado 'facturas': {aliado_id}/{empresa_id}/{archivo}
  nombre_archivo  text not null,
  fecha_carga     timestamptz not null default now(),
  validacion      text not null default 'pendiente' check (validacion in ('pendiente', 'revisado')),
  aprobado        public.estado_triple not null default 'revision',

  constraint facturas_empresa_aliado_fkey
    foreign key (empresa_id, aliado_id) references public.empresas (id, aliado_id) on delete cascade,
  -- Destino de la FK de empresas.factura_id: la factura debe pertenecer a esa empresa.
  constraint facturas_id_empresa_key unique (id, empresa_id)
);

create index facturas_empresa_aliado_idx on public.facturas (empresa_id, aliado_id);
create index facturas_aliado_id_idx on public.facturas (aliado_id);

alter table public.empresas
  add constraint empresas_factura_fkey
  foreign key (factura_id, id) references public.facturas (id, empresa_id)
  on delete set null (factura_id);

create index empresas_factura_id_idx on public.empresas (factura_id) where factura_id is not null;

-- Espejo del avance en Clientify, 1:1 con empresas ------------------------------

create table public.avance_empresa (
  empresa_id                uuid primary key references public.empresas (id) on delete cascade,
  -- Variables de calidad
  calificado                public.estado_triple not null default 'revision',
  perfecto                  public.estado_triple not null default 'revision', -- se inicializa desde empresas.es_perfecto
  oportunidad_tecnica       public.estado_triple not null default 'revision', -- "Evaluación técnica realizada"
  integridad_informacion    public.estado_triple not null default 'revision',
  -- §6.1: 100 × (0.40·calificado + 0.30·perfecto + 0.20·oportunidad_tecnica + 0.10·integridad),
  -- con si = 1 y no = 0. NULL si alguna de las 4 está en 'revision' (se excluye del promedio).
  calidad_empresa           numeric(5,2) generated always as (
    case
      when calificado = 'revision'
        or perfecto = 'revision'
        or oportunidad_tecnica = 'revision'
        or integridad_informacion = 'revision'
      then null
      else (case when calificado = 'si' then 40 else 0 end)
         + (case when perfecto = 'si' then 30 else 0 end)
         + (case when oportunidad_tecnica = 'si' then 20 else 0 end)
         + (case when integridad_informacion = 'si' then 10 else 0 end)
    end
  ) stored,
  -- Variables de avance comercial (derivadas de la fase de la oportunidad, §8)
  propuesta_comercial       public.estado_triple not null default 'revision',
  negocio_cerrado           public.estado_triple not null default 'revision',
  -- Variables de penalización
  informacion_falsa         public.estado_triple not null default 'revision',
  fuera_perfil              public.estado_triple not null default 'revision',
  -- Datos crudos de Clientify
  estado_contacto_clientify text,
  fase_oportunidad          text,
  fase_oportunidad_num      integer check (fase_oportunidad_num >= 0),
  estado_oportunidad        text check (estado_oportunidad in ('abierta', 'ganada', 'perdida')),
  lead_scoring              numeric,  -- solo para dashboards; nunca para calidad ni niveles
  valor_oportunidad         numeric,
  valor_cotizado            numeric,
  potencia_instalada_kwp    numeric,
  fecha_calificado          timestamptz, -- momento en que calificado pasó a 'si' (Racha)
  clientify_updated_at      timestamptz,
  updated_at                timestamptz not null default now()
);

create trigger avance_empresa_set_updated_at
  before update on public.avance_empresa
  for each row execute function interno.set_updated_at();
