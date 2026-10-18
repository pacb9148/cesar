-- Memoria del sistema: lo que aprende de los ajustes que guarda cada usuario (qué partida de la hoja Datos corresponde a cada descripción
-- del presupuesto y qué partidas agrega por elemento). Las claves son textos normalizados; el valor guarda los conteos.
create table if not exists conocimiento (
  usuario_id uuid not null references usuarios(id) on delete cascade,
  tipo text not null check (tipo in ('partida', 'elemento')),
  clave text not null,
  valor jsonb not null default '{}'::jsonb,
  veces integer not null default 1,
  actualizado timestamptz not null default now(),
  primary key (usuario_id, tipo, clave)
);
