import { conUsuario, json } from "@/lib/api";
import { listarProveedores } from "@/lib/ia/repo-proveedores";
import { probarYRegistrar } from "@/lib/ia/servicio-proveedores";

export const maxDuration = 120;

/** Vuelve a probar un proveedor guardado. Si responde bien (re)entra en servicio. */
export const POST = conUsuario<{ id: string }>(async (_req, u, { id }) => {
  const prueba = await probarYRegistrar(u.id, id);
  return json({ prueba, proveedores: await listarProveedores(u.id) });
});
