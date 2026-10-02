import { z } from "zod";
import { crearUsuario, hayUsuarios, iniciarSesionDe, usuarioActual } from "@/lib/auth";
import { fallo, json } from "@/lib/api";

const cuerpo = z.object({ email: z.string().email(), nombre: z.string().min(2).max(80), clave: z.string().min(10).max(200) });

/**
 * El primer usuario del sistema se registra solo y queda como admin.
 * Después solo un admin con sesión puede crear usuarios: no hay registro público.
 */
export async function POST(req: Request) {
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo("Datos inválidos (la contraseña lleva al menos 10 caracteres)");
  const hay = await hayUsuarios();
  const actual = await usuarioActual();
  if (hay && actual?.rol !== "admin") return fallo("El registro está cerrado. Pide a un administrador que cree tu usuario.", 403);
  try {
    const u = await crearUsuario(p.data.email, p.data.nombre, p.data.clave, hay ? "liquidador" : "admin");
    if (!hay) await iniciarSesionDe(u.id);
    return json({ ok: true, rol: u.rol });
  } catch (e) {
    return fallo(/unique|duplicate/i.test(String(e)) ? "Ese correo ya está registrado" : "No se pudo crear el usuario", 400);
  }
}
