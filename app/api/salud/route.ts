import { existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { usuarioActual } from "@/lib/auth";
import { consulta } from "@/lib/db";
import { ErrorHttp, fetchSeguro } from "@/lib/ia/red-segura";

export const dynamic = "force-dynamic";

const AYUDA: Record<string, string> = {
  ECONNREFUSED: "El servidor de base de datos rechaza la conexión (host o puerto incorrectos).",
  ETIMEDOUT: "No hay ruta de red hacia la base (host, puerto o firewall).",
  TIMEOUT: "La conexión a la base expiró: el host no es alcanzable desde este contenedor.",
  ENOTFOUND: "El nombre del servidor de la base no se resuelve.",
  "28P01": "Usuario o contraseña de la base incorrectos.",
  "28000": "La base rechazó al usuario.",
  "3D000": "La base indicada no existe.",
  "42501": "El usuario no tiene permisos sobre el schema.",
  "3F000": "El schema indicado (DB_SCHEMA) no existe.",
  ECONNRESET: "La conexión fue cerrada por el servidor (¿SSL requerido o prohibido?).",
};

function clasificar(e: unknown): { codigo: string; ayuda: string } {
  const err = e as { code?: string; message?: string };
  const codigo = err.code ?? (/timeout/i.test(err.message ?? "") ? "TIMEOUT" : "DESCONOCIDO");
  return { codigo, ayuda: AYUDA[codigo] ?? "Error al consultar la base; revisa el log del servidor." };
}

/** Diagnóstico sin secretos: qué variables hay, si la base responde y si las tablas existen. */
const DESTINOS_RED = ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "openrouter.ai", "integrate.api.nvidia.com"];

/** Salida a Internet hacia los proveedores de IA: cualquier respuesta HTTP (incluso 401) prueba que hay ruta; el fallo de red no. */
async function probarSalida() {
  return Promise.all(
    DESTINOS_RED.map(async (host) => {
      const t0 = Date.now();
      let familias: number[] = [];
      try {
        familias = [...new Set((await lookup(host, { all: true })).map((d) => d.family))];
      } catch {
        return { host, ok: false, error: "el DNS no resuelve", ms: Date.now() - t0 };
      }
      try {
        await fetchSeguro(`https://${host}/`, { metodo: "GET", timeoutMs: 15_000 });
        return { host, ok: true, estado: 200, familias, ms: Date.now() - t0 };
      } catch (e) {
        if (e instanceof ErrorHttp && e.estado > 0) return { host, ok: true, estado: e.estado, familias, ms: Date.now() - t0 };
        return { host, ok: false, familias, error: e instanceof Error ? e.message : "fallo", ms: Date.now() - t0 };
      }
    }),
  );
}

/** POST con la forma de una llamada de chat y una clave falsa: debe volver un 401 enseguida. Si no, falla el POST, no el modelo. */
async function probarPost() {
  const destinos: [string, string, Record<string, string>, unknown][] = [
    ["api.openai.com", "https://api.openai.com/v1/chat/completions", { Authorization: "Bearer sk-prueba-de-red" }, { model: "gpt-4o-mini", messages: [{ role: "user", content: "hola" }], max_tokens: 5 }],
    ["integrate.api.nvidia.com", "https://integrate.api.nvidia.com/v1/chat/completions", { Authorization: "Bearer nvapi-prueba-de-red" }, { model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "hola" }], max_tokens: 5 }],
    ["api.anthropic.com", "https://api.anthropic.com/v1/messages", { "x-api-key": "sk-ant-prueba-de-red", "anthropic-version": "2023-06-01" }, { model: "claude-haiku-4-5-20251001", max_tokens: 5, messages: [{ role: "user", content: "hola" }] }],
  ];
  return Promise.all(
    destinos.map(async ([host, url, cabeceras, cuerpo]) => {
      const t0 = Date.now();
      try {
        await fetchSeguro(url, { cabeceras, cuerpo, timeoutMs: 20_000 });
        return { host, ok: true, estado: 200, ms: Date.now() - t0 };
      } catch (e) {
        if (e instanceof ErrorHttp && e.estado > 0) return { host, ok: true, estado: e.estado, ms: Date.now() - t0 };
        return { host, ok: false, error: e instanceof Error ? e.message : "fallo", ms: Date.now() - t0 };
      }
    }),
  );
}

export async function GET(req: Request) {
  const env = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    DB_SCHEMA: !!process.env.DB_SCHEMA,
    APP_SECRET: (process.env.APP_SECRET?.length ?? 0) >= 32,
    GEMINI_API_KEY_respaldo: !!process.env.GEMINI_API_KEY,
  };
  const herramientas = {
    chromium: [process.env.CHROME_PATH, "/usr/bin/chromium"].some((p) => !!p && existsSync(p)),
    libreoffice: [process.env.SOFFICE_PATH, "/usr/bin/soffice"].some((p) => !!p && existsSync(p)),
  };
  let db: Record<string, unknown>;
  if (!env.DATABASE_URL && process.env.DB_MODE !== "pglite") {
    db = { ok: false, codigo: "SIN_VARIABLE", ayuda: "Falta DATABASE_URL en las variables de entorno del servicio." };
  } else {
    try {
      await consulta("select 1");
      const t = await consulta<{ n: number }>("select count(*)::int as n from information_schema.tables where table_schema = current_schema()");
      let migraciones: string[] = [];
      try {
        migraciones = (await consulta<{ nombre: string }>("select nombre from _migraciones order by nombre")).map((r) => String(r.nombre));
      } catch {
        /* aún sin tabla de migraciones */
      }
      db = { ok: true, tablas: t[0]?.n ?? 0, migraciones, ayuda: migraciones.length ? "Base lista." : "Conecta, pero faltan las migraciones (revisa el log de arranque)." };
    } catch (e) {
      db = { ok: false, ...clasificar(e) };
    }
  }
  const ok = (db as { ok: boolean }).ok === true && env.APP_SECRET;
  // La prueba de red hace conexiones de salida: solo para un administrador con sesión.
  const admin = new URL(req.url).searchParams.get("red") === "1" && (await usuarioActual())?.rol === "admin";
  const salida = admin ? await probarSalida() : undefined;
  const salidaPost = admin ? await probarPost() : undefined;
  return Response.json({ ok, node: process.version, env, db, herramientas, ...(salida ? { salida, salidaPost } : {}) }, { status: ok ? 200 : 503 });
}
