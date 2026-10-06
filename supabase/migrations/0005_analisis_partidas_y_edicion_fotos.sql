-- Resultados temporales del análisis partida por partida: permiten retomar un ajuste interrumpido sin repetir lo ya analizado.
-- Se borran al consolidar el ajuste en un solo documento.
create table if not exists analisis_partidas (
  caso_id uuid not null references casos(id) on delete cascade,
  huella text not null,
  item text not null,
  estado text not null check (estado in ('ok','error')),
  clasificacion jsonb,
  error text,
  modelo text,
  actualizado timestamptz not null default now(),
  primary key (caso_id, huella, item)
);

-- Edición de cada fotografía (recorte, giro, volteo, ajustes y si va al informe): solo parámetros, el original no se toca.
alter table archivos add column if not exists edicion jsonb;
