-- BYOK: cada liquidador guarda su propia clave de IA, cifrada en reposo (AES-256-GCM, clave maestra APP_SECRET).
create table if not exists credenciales_ia (
  usuario_id uuid primary key references usuarios(id) on delete cascade,
  proveedor text not null default 'gemini' check (proveedor in ('gemini')),
  modelo text not null,
  clave_cifrada text not null,
  ultimos4 text not null,
  actualizado timestamptz not null default now()
);
