-- Proveedores de IA por usuario (BYOK abierto): varios proveedores, modelos y claves, con prioridad y estado de salud.
-- Las claves siguen cifradas en reposo (AES-256-GCM, clave maestra APP_SECRET).
create table if not exists proveedores_ia (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  nombre text not null,
  tipo text not null check (tipo in ('gemini','anthropic','openai','openrouter','nvidia','compatible')),
  base_url text,
  modelo text not null,
  clave_cifrada text not null,
  ultimos4 text not null,
  prioridad integer not null default 1,
  activo boolean not null default false,
  estado text not null default 'sin_probar' check (estado in ('sin_probar','ok','error')),
  ultimo_error text,
  ultima_prueba timestamptz,
  ultimo_exito timestamptz,
  fallos_seguidos integer not null default 0,
  en_pausa_hasta timestamptz,
  creado timestamptz not null default now()
);
create index if not exists proveedores_ia_usuario_idx on proveedores_ia(usuario_id, prioridad);

-- La clave de Gemini que ya hubiera guardado un usuario pasa a ser su primer proveedor.
insert into proveedores_ia (usuario_id, nombre, tipo, modelo, clave_cifrada, ultimos4, prioridad, activo, estado)
select c.usuario_id, 'Google Gemini', 'gemini', c.modelo, c.clave_cifrada, c.ultimos4, 1, true, 'sin_probar'
from credenciales_ia c
where not exists (select 1 from proveedores_ia p where p.usuario_id = c.usuario_id);
