import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { auditar } from "@/lib/caso/repositorio";
import { actualizarProveedor, eliminarProveedor, listarProveedores, moverProveedor } from "@/lib/ia/repo-proveedores";
import { probarYRegistrar } from "@/lib/ia/servicio-proveedores";
import { campoClave, campoModelo } from "@/lib/ia/validacion";

export const maxDuration = 120;

const cambios = z.object({
  nombre: z.string().trim().min(1).max(60).optional(),
  modelo: campoModelo.optional(),
  clave: campoClave.optional(),
  activo: z.boolean().optional(),
  mover: z.enum(["subir", "bajar"]).optional(),
});

export const PATCH = conUsuario<{ id: string }>(async (req, u, { id }) => {
  const p = cambios.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos inválidos");
  const { mover, activo, ...campos } = p.data;
  if (mover) await moverProveedor(u.id, id, mover);
  const tocaCredenciales = campos.modelo !== undefined || campos.clave !== undefined;
  // Cambiar la clave o el modelo, o encender el proveedor, exige una prueba real antes de que vuelva a estar en servicio.
  await actualizarProveedor(u.id, id, { ...campos, ...(activo === false ? { activo: false } : {}), ...(tocaCredenciales ? { activo: false } : {}) });
  let prueba = null;
  if (tocaCredenciales || activo === true) prueba = await probarYRegistrar(u.id, id);
  await auditar(u.id, null, "ia.editar_proveedor", { id, campos: Object.keys(p.data), probado: prueba?.ok ?? null });
  return json({ prueba, proveedores: await listarProveedores(u.id) });
});

export const DELETE = conUsuario<{ id: string }>(async (_req, u, { id }) => {
  await eliminarProveedor(u.id, id);
  await auditar(u.id, null, "ia.eliminar_proveedor", { id });
  return json({ proveedores: await listarProveedores(u.id) });
});
