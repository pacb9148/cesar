import pg from "pg";
import type { PGlite } from "@electric-sql/pglite";

/**
 * Acceso a PostgreSQL. En producción: `pg` contra la base del tenant (red privada de runwebx.com).
 * En local sin acceso a esa red: DB_MODE=pglite, un Postgres embebido con las mismas migraciones.
 * Regla del proyecto: el SQL no usa el prefijo `public.`; el schema propio se fija con search_path.
 */
export type Fila = Record<string, unknown>;

type Consulta = <T extends Fila>(sql: string, params?: unknown[]) => Promise<T[]>;
type Motor = {
  query: Consulta;
  tx: <R>(fn: (q: Consulta) => Promise<R>) => Promise<R>;
};

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
// Next carga páginas y rutas en grafos de módulos distintos: el motor se comparte por globalThis.
const g = globalThis as unknown as { __cesarDb?: Promise<Motor> };

async function crearPg(): Promise<Motor> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (o usa DB_MODE=pglite en local)");
  const schema = process.env.DB_SCHEMA;
  const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 15000 });
  pool.on("connect", (c) => {
    if (schema) void c.query(`SET search_path TO ${ident(schema)}`);
  });
  pool.on("error", (e) => console.error("[db] error de conexión", e.message));
  const query: Consulta = async <T extends Fila>(sql: string, params?: unknown[]) =>
    (await pool.query(sql, params as unknown[])).rows as T[];
  return {
    query,
    tx: async (fn) => {
      const c = await pool.connect();
      try {
        if (schema) await c.query(`SET search_path TO ${ident(schema)}`);
        await c.query("BEGIN");
        const r = await fn(async <T extends Fila>(sql: string, params?: unknown[]) => (await c.query(sql, params as unknown[])).rows as T[]);
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
  };
}

async function crearPglite(): Promise<Motor> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? ".pglite";
  const lite: PGlite = dir === "memory" ? new PGlite() : new PGlite(dir);
  await lite.waitReady;
  // Con la base embebida las migraciones se aplican solas al abrir (en producción corre `npm run migrar`).
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  await lite.exec("create table if not exists _migraciones (nombre text primary key, aplicada timestamptz not null default now())");
  const hechas = new Set((await lite.query<{ nombre: string }>("select nombre from _migraciones")).rows.map((r) => r.nombre));
  const carpeta = join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(carpeta).filter((x) => x.endsWith(".sql")).sort()) {
    if (hechas.has(f)) continue;
    await lite.exec(readFileSync(join(carpeta, f), "utf8"));
    await lite.query("insert into _migraciones(nombre) values ($1)", [f]);
  }
  const query: Consulta = async <T extends Fila>(sql: string, params?: unknown[]) => {
    // PGlite solo admite varias sentencias sin parámetros (migraciones).
    if (!params || params.length === 0) {
      const res = await lite.exec(sql);
      return (res[res.length - 1]?.rows ?? []) as T[];
    }
    return (await lite.query(sql, params)).rows as T[];
  };
  return {
    query,
    tx: async (fn) => {
      await lite.exec("BEGIN");
      try {
        const r = await fn(query);
        await lite.exec("COMMIT");
        return r;
      } catch (e) {
        await lite.exec("ROLLBACK").catch(() => undefined);
        throw e;
      }
    },
  };
}

export function db(): Promise<Motor> {
  g.__cesarDb ??= process.env.DB_MODE === "pglite" ? crearPglite() : crearPg();
  return g.__cesarDb;
}

export async function consulta<T extends Fila = Fila>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db()).query<T>(sql, params);
}
export async function uno<T extends Fila = Fila>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await consulta<T>(sql, params))[0] ?? null;
}
export async function transaccion<R>(fn: (q: Consulta) => Promise<R>): Promise<R> {
  return (await db()).tx(fn);
}
