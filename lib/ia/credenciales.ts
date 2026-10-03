import { consulta, uno } from "../db";
import { cifrar, descifrar } from "./cifrado";

export type EstadoCredencial = { configurada: boolean; modelo: string | null; ultimos4: string | null; actualizado: string | null };

/** Lo único que sale hacia el navegador: nunca la clave, solo sus últimos 4 caracteres. */
export async function estadoCredencial(usuarioId: string): Promise<EstadoCredencial> {
  const r = await uno<{ modelo: string; ultimos4: string; actualizado: string }>("select modelo, ultimos4, actualizado from credenciales_ia where usuario_id = $1", [usuarioId]);
  return r ? { configurada: true, modelo: r.modelo, ultimos4: r.ultimos4, actualizado: r.actualizado } : { configurada: false, modelo: null, ultimos4: null, actualizado: null };
}

export async function guardarCredencial(usuarioId: string, modelo: string, claveNueva: string | null) {
  if (claveNueva) {
    await consulta(
      `insert into credenciales_ia(usuario_id, modelo, clave_cifrada, ultimos4) values ($1,$2,$3,$4)
       on conflict (usuario_id) do update set modelo = excluded.modelo, clave_cifrada = excluded.clave_cifrada, ultimos4 = excluded.ultimos4, actualizado = now()`,
      [usuarioId, modelo, cifrar(claveNueva), claveNueva.slice(-4)],
    );
    return;
  }
  // Solo cambio de modelo: la clave guardada se conserva.
  const n = await consulta("update credenciales_ia set modelo = $2, actualizado = now() where usuario_id = $1 returning usuario_id", [usuarioId, modelo]);
  if (n.length === 0) throw new Error("Primero ingresa tu clave de API.");
}

export async function borrarCredencial(usuarioId: string) {
  await consulta("delete from credenciales_ia where usuario_id = $1", [usuarioId]);
}

/** Uso interno del servidor: clave descifrada y modelo del usuario. */
export async function credencialDe(usuarioId: string): Promise<{ clave: string; modelo: string } | null> {
  const r = await uno<{ modelo: string; clave_cifrada: string }>("select modelo, clave_cifrada from credenciales_ia where usuario_id = $1", [usuarioId]);
  return r ? { clave: descifrar(r.clave_cifrada), modelo: r.modelo } : null;
}

export type ModeloDisponible = { id: string; nombre: string };

/** Pregunta a Google qué modelos puede usar esa clave: así el selector nunca ofrece un identificador inventado. */
export async function modelosDisponibles(clave: string): Promise<ModeloDisponible[]> {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
    headers: { "x-goog-api-key": clave },
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error("Google rechazó la clave (inválida o sin permiso).");
  if (!r.ok) throw new Error(`Google respondió ${r.status} al consultar los modelos.`);
  const j = (await r.json()) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
  return (j.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), nombre: m.displayName ?? m.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
