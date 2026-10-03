import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { credencialDe, modelosDisponibles } from "@/lib/ia/credenciales";

const cuerpo = z.object({ clave: z.string().trim().min(20).max(300).regex(/^[A-Za-z0-9_-]+$/).optional() });

/** Valida una clave (la escrita o la guardada) y devuelve los modelos que ella puede usar. No guarda nada. */
export const POST = conUsuario(async (req, u) => {
  const p = cuerpo.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return fallo("La clave tiene un formato no válido");
  const clave = p.data.clave ?? (await credencialDe(u.id))?.clave;
  if (!clave) return fallo("Ingresa una clave para probarla.");
  try {
    return json({ modelos: await modelosDisponibles(clave) });
  } catch (e) {
    return fallo(e instanceof Error ? e.message : "No se pudo probar la clave", 400);
  }
});
