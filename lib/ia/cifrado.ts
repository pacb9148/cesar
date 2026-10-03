import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Cifrado de las claves de IA en reposo: AES-256-GCM con una clave derivada de APP_SECRET. */
function clave(): Buffer {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("Falta APP_SECRET (mínimo 32 caracteres) en las variables de entorno: sin ella no se pueden guardar claves de IA.");
  return createHash("sha256").update(`cesar-byok|${s}`).digest();
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave(), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${datos.toString("base64")}`;
}

export function descifrar(token: string): string {
  const [v, iv, tag, datos] = token.split(".");
  if (v !== "v1" || !iv || !tag || !datos) throw new Error("Formato de clave guardada no reconocido");
  const d = createDecipheriv("aes-256-gcm", clave(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([d.update(Buffer.from(datos, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error("No se pudo descifrar la clave guardada (¿cambió APP_SECRET?). Vuelve a ingresarla en Ajustes.");
  }
}
