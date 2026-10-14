import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { auditar, casoConSiniestro, eliminarCaso, obtenerCaso, renombrarCaso } from "@/lib/caso/repositorio";

const cuerpo = z.object({ siniestro: z.string().trim().min(1).max(30) });

/** Cambia el número de siniestro; no admite uno que ya tenga otro caso (evita casos duplicados). */
export const PATCH = conUsuario<{ id: string }>(async (req, u, { id }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo("Escribe un número de siniestro (hasta 30 caracteres)");
  const otro = await casoConSiniestro(u.id, p.data.siniestro, id);
  if (otro) return fallo(`Ya existe otro caso con el siniestro ${p.data.siniestro}.`, 409);
  await renombrarCaso(id, p.data.siniestro);
  await auditar(u.id, id, "caso.renombrar", { siniestro: p.data.siniestro });
  return json({ ok: true });
});

/** Elimina el caso con todo lo suyo (archivos, lecturas, ajustes, documentos generados, registros). */
export const DELETE = conUsuario<{ id: string }>(async (_req, u, { id }) => {
  if (!(await eliminarCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  await auditar(u.id, null, "caso.eliminar", { caso: id });
  return json({ ok: true });
});
