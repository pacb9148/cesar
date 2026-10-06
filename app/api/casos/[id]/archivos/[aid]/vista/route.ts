import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { auditar, obtenerCaso } from "@/lib/caso/repositorio";
import { guardarEdicion, pdfDe, vistaDe } from "@/lib/caso/edicion-documentos";

export const maxDuration = 180;
export const runtime = "nodejs";

const run = z.object({ t: z.string().max(5000), b: z.boolean().optional(), i: z.boolean().optional(), u: z.boolean().optional() });
const runs = z.array(run).max(300);
const cuerpo = z.object({
  word: z
    .object({
      parrafos: z.record(z.string().regex(/^\d+$/), runs).refine((o) => Object.keys(o).length <= 500, "Demasiados párrafos editados").optional(),
      insertar: z.array(z.object({ despuesDe: z.number().int().min(0), runs })).max(200).optional(),
      eliminar: z.array(z.number().int().min(0)).max(500).optional(),
    })
    .optional(),
  celdas: z.array(z.object({ hoja: z.string().max(60), r: z.number().int().min(1), c: z.number().int().min(1), valor: z.string().max(500) })).max(2000).optional(),
});

/** Vista de un entregable (Word o Excel) para revisarlo y editarlo; con `?pdf=1`, el PDF exacto (LibreOffice) del Word actual. */
export const GET = conUsuario<{ id: string; aid: string }>(async (req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  if (new URL(req.url).searchParams.get("pdf") === "1") {
    try {
      const pdf = await pdfDe(id, aid);
      return pdf ? new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Content-Disposition": "inline" } }) : fallo("Este documento no es un Word.", 404);
    } catch (e) {
      return fallo(e instanceof Error ? e.message : "No se pudo generar el PDF", 501);
    }
  }
  const v = await vistaDe(id, aid);
  return v ? json(v) : fallo("Este documento no tiene vista previa (solo Word y Excel).", 404);
});

/** Guarda las ediciones en el propio entregable y rehace lo que depende de él (cuadro y totales del Word, PDF, ZIP). */
export const PUT = conUsuario<{ id: string; aid: string }>(async (req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Edición inválida");
  try {
    const r = await guardarEdicion(id, u.id, aid, p.data);
    await auditar(u.id, id, "documento.editar", { archivo: aid, aplicados: r.aplicados });
    return json(r);
  } catch (e) {
    return fallo(e instanceof Error ? e.message : "No se pudo guardar", 422);
  }
});
