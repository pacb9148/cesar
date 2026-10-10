import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { aplicarCambioFotos, guardarLeyendaGrupo } from "@/lib/caso/edicion-documentos";
import { auditar, obtenerCaso } from "@/lib/caso/repositorio";

export const maxDuration = 180;
export const runtime = "nodejs";

const cuerpo = z.object({ recinto: z.string().trim().min(1).max(120), leyenda: z.string().max(300) });

/** Guarda la leyenda al pie del grupo de fotos de una estancia y rehace el informe y el anexo. */
export const PUT = conUsuario<{ id: string }>(async (req, u, { id }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Leyenda inválida");
  const avisos = await aplicarCambioFotos(id, u.id, () => guardarLeyendaGrupo(id, p.data.recinto, p.data.leyenda));
  await auditar(u.id, id, "fotos.leyenda_grupo", { recinto: p.data.recinto });
  return json({ ok: true, avisos });
});
