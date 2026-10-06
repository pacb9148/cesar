import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { auditar, obtenerCaso } from "@/lib/caso/repositorio";
import { guardarEdicion, vistaDe } from "@/lib/caso/edicion-documentos";

export const maxDuration = 120;
export const runtime = "nodejs";

const cuerpo = z.object({
  textos: z.record(z.string().regex(/^\d+$/), z.string().max(5000)).refine((o) => Object.keys(o).length <= 500, "Demasiados párrafos editados").optional(),
  celdas: z.array(z.object({ hoja: z.string().max(60), r: z.number().int().min(1), c: z.number().int().min(1), valor: z.string().max(500) })).max(2000).optional(),
});

/** Vista de un entregable (Word o Excel) para revisarlo y editarlo antes de descargarlo. */
export const GET = conUsuario<{ id: string; aid: string }>(async (_req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const v = await vistaDe(id, aid);
  return v ? json(v) : fallo("Este documento no tiene vista previa (solo Word y Excel).", 404);
});

/** Guarda las ediciones en el propio entregable y rehace el PDF y el paquete ZIP que dependen de él. */
export const PUT = conUsuario<{ id: string; aid: string }>(async (req, u, { id, aid }) => {
  const caso = await obtenerCaso(id, u.id);
  if (!caso) return fallo("Caso no encontrado", 404);
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Edición inválida");
  const pie = `Liquidación ${caso.datos.liquidacion ?? ""}/${(caso.datos.fechas?.ocurrencia ?? "").slice(0, 4)}`;
  try {
    const r = await guardarEdicion(id, aid, p.data, pie);
    await auditar(u.id, id, "documento.editar", { archivo: aid, aplicados: r.aplicados });
    return json(r);
  } catch (e) {
    return fallo(e instanceof Error ? e.message : "No se pudo guardar", 422);
  }
});
