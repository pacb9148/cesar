import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { resumenConocimiento } from "@/lib/conocimiento";
import { leerAprendido, listarMemoria, olvidar } from "@/lib/conocimiento/repo";

/** Lo que el sistema ha aprendido de los ajustes de este usuario, con su tamaño y la semilla de los ajustes de referencia. */
export const GET = conUsuario(async (_req, u) => {
  const [aprendido, entradas] = await Promise.all([leerAprendido(u.id), listarMemoria(u.id)]);
  return json({ resumen: resumenConocimiento(aprendido), entradas });
});

const cuerpo = z.object({ tipo: z.enum(["partida", "elemento"]), clave: z.string().min(1).max(300) });

/** Olvidar una entrada aprendida (por ejemplo, una asociación equivocada). */
export const DELETE = conUsuario(async (req, u) => {
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo("Entrada inválida");
  await olvidar(u.id, p.data.tipo, p.data.clave);
  return json({ ok: true });
});
