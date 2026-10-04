import { conUsuario, json } from "@/lib/api";
import { auditar } from "@/lib/caso/repositorio";
import { ejecutarAjuste } from "@/lib/caso/generar";

export const maxDuration = 300;
export const runtime = "nodejs";

export const POST = conUsuario<{ id: string }>(async (_req, u, { id }) => {
  const r = await ejecutarAjuste(id, u.id);
  await auditar(u.id, id, "caso.ajustar", { version: r.version, intentos: r.intentos, errores: r.validacion.errores.length });
  return json({ version: r.version, intentos: r.intentos, errores: r.validacion.errores, advertencias: [...r.avisos, ...r.validacion.advertencias] });
});
