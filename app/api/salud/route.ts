import { existsSync } from "node:fs";
import { consulta } from "@/lib/db";

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
export async function GET() {
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
  return Response.json({ ok, env, db, herramientas }, { status: ok ? 200 : 503 });
}
