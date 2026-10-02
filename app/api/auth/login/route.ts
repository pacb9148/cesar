import { z } from "zod";
import { iniciarSesion } from "@/lib/auth";
import { fallo, json } from "@/lib/api";
import { fallido, limpiar, permitido } from "@/lib/limite";

const cuerpo = z.object({ email: z.string().email(), clave: z.string().min(1) });

export async function POST(req: Request) {
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo("Datos inválidos");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const clave = `${ip}|${p.data.email.toLowerCase()}`;
  if (!permitido(clave)) return fallo("Demasiados intentos. Espera unos minutos.", 429);
  const u = await iniciarSesion(p.data.email, p.data.clave);
  if (!u) {
    fallido(clave);
    return fallo("Correo o contraseña incorrectos", 401);
  }
  limpiar(clave);
  return json({ ok: true, nombre: u.nombre });
}
