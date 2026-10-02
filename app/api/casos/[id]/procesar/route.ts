import { conUsuario, json } from "@/lib/api";
import { procesarCaso } from "@/lib/caso/procesar";
import { auditar } from "@/lib/caso/repositorio";

export const maxDuration = 300;
export const runtime = "nodejs";

export const POST = conUsuario<{ id: string }>(async (_req, u, { id }) => {
  const r = await procesarCaso(id, u.id);
  await auditar(u.id, id, "caso.procesar", { alertas: r.alertas.length });
  return json({ alertas: r.alertas, archivosLeidos: r.archivosLeidos, partidas: r.presupuesto?.reclamacion.lineas.length ?? 0 });
});
