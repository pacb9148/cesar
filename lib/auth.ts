import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { consulta, uno } from "./db";

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, n: number) => Promise<Buffer>;
const COOKIE = "cesar_sesion";
const DURACION_MS = 1000 * 60 * 60 * 12;

export type Usuario = { id: string; email: string; nombre: string; rol: "admin" | "liquidador" };

export async function hashClave(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const h = await scrypt(clave, sal, 64);
  return `${sal.toString("hex")}:${h.toString("hex")}`;
}

async function verificarClave(clave: string, guardado: string): Promise<boolean> {
  const [sal, h] = guardado.split(":");
  if (!sal || !h) return false;
  const calc = await scrypt(clave, Buffer.from(sal, "hex"), 64);
  const esperado = Buffer.from(h, "hex");
  return calc.length === esperado.length && timingSafeEqual(calc, esperado);
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function hayUsuarios(): Promise<boolean> {
  return ((await uno<{ n: string }>("select count(*)::text as n from usuarios"))?.n ?? "0") !== "0";
}

export async function crearUsuario(email: string, nombre: string, clave: string, rol: Usuario["rol"]): Promise<Usuario> {
  if (clave.length < 10) throw new Error("La contraseña debe tener al menos 10 caracteres.");
  const r = await uno<Usuario>("insert into usuarios(email, nombre, hash_clave, rol) values ($1,$2,$3,$4) returning id, email, nombre, rol", [
    email.trim().toLowerCase(),
    nombre.trim(),
    await hashClave(clave),
    rol,
  ]);
  return r!;
}

async function abrirSesion(usuarioId: string) {
  const token = randomBytes(32).toString("hex");
  await consulta("insert into sesiones(token_hash, usuario_id, expira) values ($1,$2,$3)", [hashToken(token), usuarioId, new Date(Date.now() + DURACION_MS)]);
  const c = await cookies();
  // `Secure` solo si la petición llegó por HTTPS (el proxy lo indica en x-forwarded-proto): un navegador descarta
  // en silencio una cookie Secure recibida por http, y el usuario quedaba en un bucle de login sin ningún error.
  const h = await headers();
  const https = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https" || h.get("x-forwarded-ssl") === "on";
  c.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: https, path: "/", maxAge: DURACION_MS / 1000 });
}

export async function iniciarSesion(email: string, clave: string): Promise<Usuario | null> {
  const u = await uno<Usuario & { hash_clave: string }>("select id, email, nombre, rol, hash_clave from usuarios where email = $1", [email.trim().toLowerCase()]);
  // Se calcula el hash aunque el usuario no exista para no filtrar su existencia por tiempo de respuesta.
  const ok = await verificarClave(clave, u?.hash_clave ?? "00:00");
  if (!u || !ok) return null;
  await abrirSesion(u.id);
  return { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol };
}

export async function iniciarSesionDe(usuarioId: string) {
  await abrirSesion(usuarioId);
}

export async function cerrarSesion() {
  const c = await cookies();
  const t = c.get(COOKIE)?.value;
  if (t) await consulta("delete from sesiones where token_hash = $1", [hashToken(t)]);
  c.delete(COOKIE);
}

export async function usuarioActual(): Promise<Usuario | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  return uno<Usuario>(
    `select u.id, u.email, u.nombre, u.rol from sesiones s join usuarios u on u.id = s.usuario_id
     where s.token_hash = $1 and s.expira > now()`,
    [hashToken(t)],
  );
}

export async function exigirUsuario(): Promise<Usuario> {
  const u = await usuarioActual();
  if (!u) redirect("/login");
  return u;
}
