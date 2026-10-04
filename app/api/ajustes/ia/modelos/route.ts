import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { ErrorHttp } from "@/lib/ia/red-segura";
import { TIPOS, listarModelos, mensajeAmable } from "@/lib/ia/proveedores";
import { configDe } from "@/lib/ia/repo-proveedores";
import { campoClave } from "@/lib/ia/validacion";

export const maxDuration = 60;

const cuerpo = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({ tipo: z.enum(TIPOS), baseUrl: z.string().trim().max(200).optional(), clave: campoClave }),
]);

/** Pregunta al proveedor qué modelos admite esa clave. No guarda nada. */
export const POST = conUsuario(async (req, u) => {
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos inválidos");
  try {
    const cfg = "id" in p.data ? await configDe(u.id, p.data.id) : { tipo: p.data.tipo, baseUrl: p.data.baseUrl ?? null, clave: p.data.clave };
    if (!cfg) return fallo("Proveedor no encontrado", 404);
    return json({ modelos: await listarModelos(cfg) });
  } catch (e) {
    return fallo(e instanceof ErrorHttp ? mensajeAmable(e) : e instanceof Error ? e.message : "No se pudieron listar los modelos", 400);
  }
});
