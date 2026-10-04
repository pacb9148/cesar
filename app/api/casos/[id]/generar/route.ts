import { conUsuario } from "@/lib/api";
import { respuestaFlujo } from "@/lib/api-flujo";
import { auditar } from "@/lib/caso/repositorio";
import { generarSalidas } from "@/lib/caso/generar";

export const maxDuration = 300;
export const runtime = "nodejs";

export const POST = conUsuario<{ id: string }>(async (_req, u, { id }) =>
  respuestaFlujo(async () => {
    const r = await generarSalidas(id, u.id);
    await auditar(u.id, id, "caso.generar", { entregables: r.entregables.length, motorPdf: r.motorPdf });
    return r;
  }),
);
