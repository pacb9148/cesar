-- Esquema base del Ajustador de Siniestros. Sin prefijo `public.`: el schema lo fija search_path.

create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  nombre text not null,
  hash_clave text not null,
  rol text not null default 'liquidador' check (rol in ('admin','liquidador')),
  creado timestamptz not null default now()
);

create table if not exists sesiones (
  token_hash text primary key,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  expira timestamptz not null,
  creado timestamptz not null default now()
);

create table if not exists casos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id),
  siniestro text not null,
  estado text not null default 'borrador'
    check (estado in ('borrador','extraido','ajustado','revisado','emitido')),
  modo text not null default 'reclamacion' check (modo in ('reclamacion','perdida_determinada')),
  datos jsonb not null default '{}'::jsonb,
  valor_uf numeric,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists casos_usuario_idx on casos(usuario_id, actualizado desc);

create table if not exists archivos (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references casos(id) on delete cascade,
  nombre text not null,
  tipo text not null,
  mime text not null,
  tamano integer not null,
  sha256 text not null,
  recinto text,
  orden integer not null default 0,
  contenido bytea not null,
  creado timestamptz not null default now(),
  unique (caso_id, sha256, tipo)
);
create index if not exists archivos_caso_idx on archivos(caso_id, tipo);

-- Resultados de extracción y datos auxiliares por caso (acta, provisión, presupuesto, meteo...).
create table if not exists extracciones (
  caso_id uuid not null references casos(id) on delete cascade,
  clave text not null,
  valor jsonb not null,
  actualizado timestamptz not null default now(),
  primary key (caso_id, clave)
);

-- La reclamación es inmutable: se guarda una vez, con hash, y no admite UPDATE.
create table if not exists reclamaciones (
  caso_id uuid primary key references casos(id) on delete cascade,
  datos jsonb not null,
  hash text not null,
  creado timestamptz not null default now()
);

create or replace function bloquear_update_reclamacion() returns trigger as $$
begin
  raise exception 'La reclamación es inmutable';
end;
$$ language plpgsql;

drop trigger if exists reclamaciones_sin_update on reclamaciones;
create trigger reclamaciones_sin_update before update on reclamaciones
  for each row execute function bloquear_update_reclamacion();

create table if not exists ajustes (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references casos(id) on delete cascade,
  version integer not null,
  salida jsonb not null,
  origen text not null default 'agente' check (origen in ('agente','manual')),
  modelo text,
  prompt_version text,
  creado timestamptz not null default now(),
  unique (caso_id, version)
);

create table if not exists baremo (
  id serial primary key,
  descripcion text not null,
  pu numeric not null check (pu > 0),
  origen text not null default 'baremo',
  activo boolean not null default true,
  creado timestamptz not null default now()
);

create table if not exists llm_runs (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid references casos(id) on delete set null,
  tarea text not null,
  modelo text not null,
  prompt_version text not null,
  tokens_entrada integer,
  tokens_salida integer,
  ok boolean not null,
  error text,
  creado timestamptz not null default now()
);

create table if not exists auditoria (
  id bigserial primary key,
  usuario_id uuid,
  caso_id uuid,
  accion text not null,
  detalle jsonb,
  creado timestamptz not null default now()
);
