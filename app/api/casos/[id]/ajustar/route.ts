import { conUsuario, json } from "@/lib/api";
import { respuestaFlujo } from "@/lib/api-flujo";
import { auditar } from "@/lib/caso/repositorio";
import { ejecutarAjuste, vistaPreviaAjuste } from "@/lib/caso/generar";

export const maxDuration = 300;
export const runtime = "nodejs";

/** Vista previa: qué se enviará a la IA y a qué proveedores, sin llamarla. */
export const GET = conUsuario<{ id: string }>(async (_req, u, { id }) => json(await vistaPreviaAjuste(id, u.id)));

/** Ejecuta el ajuste emitiendo cada paso en vivo (flujo NDJSON); el último evento trae el resultado. */
export const POST = conUsuario<{ id: string }>(async (_req, u, { id }) =>
  respuestaFlujo(async () => {
    const r = await ejecutarAjuste(id, u.id);
    await auditar(u.id, id, "caso.ajustar", { version: r.version, intentos: r.intentos, errores: r.validacion.errores.length });
    return { version: r.version, intentos: r.intentos, errores: r.validacion.errores, advertencias: [...r.avisos, ...r.validacion.advertencias] };
  }),
);
