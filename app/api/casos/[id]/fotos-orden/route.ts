import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { aplicarCambioFotos } from "@/lib/caso/edicion-documentos";
import { auditar, guardarEdicionFoto, listarArchivos, obtenerCaso } from "@/lib/caso/repositorio";
import { EDICION_INICIAL } from "@/lib/fotos/recorte";

export const maxDuration = 180;
export const runtime = "nodejs";

const cuerpo = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

/** Fija el orden de aparición (1, 2, 3… de izquierda a derecha) de las fotos de una estancia y rehace el informe y el anexo. */
export const PUT = conUsuario<{ id: string }>(async (req, u, { id }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Orden inválido");
  const fotos = new Map((await listarArchivos(id, "foto")).map((f) => [f.id, f]));
  if (p.data.ids.some((x) => !fotos.has(x))) return fallo("Alguna fotografía no pertenece a este caso", 404);
  const avisos = await aplicarCambioFotos(id, u.id, async () => {
    for (const [i, fid] of p.data.ids.entries()) await guardarEdicionFoto(fid, id, { ...EDICION_INICIAL, ...(fotos.get(fid)!.edicion ?? {}), orden: i + 1 });
  });
  await auditar(u.id, id, "fotos.orden", { fotos: p.data.ids.length });
  return json({ ok: true, avisos });
});
