import { conUsuario, fallo, json } from "@/lib/api";
import { auditar, guardarEdicionFoto, obtenerCaso } from "@/lib/caso/repositorio";
import { sincronizarFotos } from "@/lib/caso/edicion-documentos";
import { edicionFotoSchema } from "@/lib/fotos/recorte";

/** Guarda la edición de una fotografía (solo parámetros: el original no se modifica). */
export const maxDuration = 180;
export const runtime = "nodejs";

export const PUT = conUsuario<{ id: string; aid: string }>(async (req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const p = edicionFotoSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Edición inválida");
  if (!(await guardarEdicionFoto(aid, id, p.data))) return fallo("Fotografía no encontrada", 404);
  await auditar(u.id, id, "foto.editar", { archivo: aid });
  // La foto ya editada pasa sola a los documentos generados (informe, anexo, PDF y ZIP): no hay que repetir nada.
  return json({ ok: true, avisos: await sincronizarFotos(id, u.id).catch((e: unknown) => [`No se pudo actualizar los documentos: ${e instanceof Error ? e.message : "error"}`]) });
});

/** Descarta la edición y vuelve al recorte automático. */
export const DELETE = conUsuario<{ id: string; aid: string }>(async (_req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  if (!(await guardarEdicionFoto(aid, id, null))) return fallo("Fotografía no encontrada", 404);
  return json({ ok: true, avisos: await sincronizarFotos(id, u.id).catch(() => []) });
});
