import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { aplicarCambioFotos } from "@/lib/caso/edicion-documentos";
import { auditar, guardarEdicionFoto, listarArchivos, obtenerCaso } from "@/lib/caso/repositorio";
import { EDICION_INICIAL } from "@/lib/fotos/recorte";

export const maxDuration = 180;
export const runtime = "nodejs";

const cuerpo = z.object({
  /** Fotos del grupo que van al informe, en el orden de aparición (de izquierda a derecha). */
  ids: z.array(z.string().uuid()).max(200),
  /** Fotos del grupo que el usuario sacó del informe. */
  quitar: z.array(z.string().uuid()).max(200).default([]),
});

/** Aplica de una vez los cambios de un grupo (qué fotos van y en qué orden, de izquierda a derecha) y rehace el informe y el anexo. */
export const PUT = conUsuario<{ id: string }>(async (req, u, { id }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Orden inválido");
  const fotos = new Map((await listarArchivos(id, "foto")).map((f) => [f.id, f]));
  if ([...p.data.ids, ...p.data.quitar].some((x) => !fotos.has(x))) return fallo("Alguna fotografía no pertenece a este caso", 404);
  const avisos = await aplicarCambioFotos(id, u.id, async () => {
    for (const [i, fid] of p.data.ids.entries()) await guardarEdicionFoto(fid, id, { ...EDICION_INICIAL, ...(fotos.get(fid)!.edicion ?? {}), orden: i + 1, incluir: true, excluir: false });
    for (const fid of p.data.quitar) {
      const { orden: _orden, ...resto } = { ...EDICION_INICIAL, ...(fotos.get(fid)!.edicion ?? {}) };
      void _orden;
      await guardarEdicionFoto(fid, id, { ...resto, incluir: false, excluir: true });
    }
  });
  await auditar(u.id, id, "fotos.orden", { fotos: p.data.ids.length, quitadas: p.data.quitar.length });
  return json({ ok: true, avisos });
});
