import { conUsuario, fallo, json } from "@/lib/api";
import { auditar, guardarEdicionFoto, obtenerCaso } from "@/lib/caso/repositorio";
import { edicionFotoSchema } from "@/lib/fotos/recorte";

/** Guarda la edición de una fotografía (solo parámetros: el original no se modifica). */
export const PUT = conUsuario<{ id: string; aid: string }>(async (req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const p = edicionFotoSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Edición inválida");
  if (!(await guardarEdicionFoto(aid, id, p.data))) return fallo("Fotografía no encontrada", 404);
  await auditar(u.id, id, "foto.editar", { archivo: aid });
  return json({ ok: true });
});

/** Descarta la edición y vuelve al recorte automático. */
export const DELETE = conUsuario<{ id: string; aid: string }>(async (_req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  if (!(await guardarEdicionFoto(aid, id, null))) return fallo("Fotografía no encontrada", 404);
  return json({ ok: true });
});
