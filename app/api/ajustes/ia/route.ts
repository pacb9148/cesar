import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { auditar } from "@/lib/caso/repositorio";
import { borrarCredencial, estadoCredencial, guardarCredencial } from "@/lib/ia/credenciales";

const cuerpo = z.object({
  modelo: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._-]+$/, "Identificador de modelo inválido"),
  clave: z.string().trim().min(20).max(300).regex(/^[A-Za-z0-9_-]+$/, "La clave tiene caracteres no válidos").optional(),
});

export const GET = conUsuario(async (_req, u) => json(await estadoCredencial(u.id)));

export const PUT = conUsuario(async (req, u) => {
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos inválidos");
  try {
    await guardarCredencial(u.id, p.data.modelo, p.data.clave ?? null);
  } catch (e) {
    return fallo(e instanceof Error ? e.message : "No se pudo guardar", 400);
  }
  // La auditoría registra el hecho, jamás la clave.
  await auditar(u.id, null, "ia.guardar_credencial", { modelo: p.data.modelo, cambioClave: !!p.data.clave });
  return json(await estadoCredencial(u.id));
});

export const DELETE = conUsuario(async (_req, u) => {
  await borrarCredencial(u.id);
  await auditar(u.id, null, "ia.borrar_credencial");
  return json(await estadoCredencial(u.id));
});
