import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consulta, transaccion } from "./index";

/**
 * Aplica supabase/migrations/*.sql en orden. Un bloqueo asesor evita que dos instancias que arrancan a la vez
 * ejecuten la misma migración. Las migraciones usan `if not exists`, así que repetirlas es seguro.
 */
export async function aplicarMigraciones(log: (m: string) => void = console.log): Promise<void> {
  const dir = join(process.cwd(), "supabase", "migrations");
  const archivos = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort();
  await consulta("create table if not exists _migraciones (nombre text primary key, aplicada timestamptz not null default now())");
  const hechas = new Set((await consulta<{ nombre: string }>("select nombre from _migraciones")).map((r) => String(r.nombre)));
  for (const f of archivos) {
    if (hechas.has(f)) continue;
    await transaccion(async (q) => {
      if (process.env.DB_MODE !== "pglite") await q("select pg_advisory_xact_lock(7340211)");
      const ya = await q<{ n: number }>("select count(*)::int as n from _migraciones where nombre = $1", [f]);
      if (ya[0]?.n) return;
      await q(readFileSync(join(dir, f), "utf8"));
      await q("insert into _migraciones(nombre) values ($1)", [f]);
      log(`migración aplicada: ${f}`);
    });
  }
}
