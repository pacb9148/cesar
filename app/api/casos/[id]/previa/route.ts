import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { previaExcel, previaInforme } from "@/lib/caso/generar";
import { obtenerCaso } from "@/lib/caso/repositorio";
import { salidaAgenteSchema } from "@/lib/domain/tipos";

export const maxDuration = 180;
export const runtime = "nodejs";

const cuerpo = z.object({ tipo: z.enum(["excel", "informe"]), salida: salidaAgenteSchema.optional() });

/** Vista previa (solo lectura) del Excel de ajuste o del informe con los datos actuales; no guarda ni genera nada. */
export const POST = conUsuario<{ id: string }>(async (req, u, { id }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo("Petición inválida");
  try {
    return json(p.data.tipo === "excel" ? await previaExcel(id, u.id, p.data.salida) : await previaInforme(id, u.id));
  } catch (e) {
    return fallo(e instanceof Error ? e.message : "No se pudo preparar la vista previa", 422);
  }
});
