// Aplica supabase/migrations/*.sql contra la base configurada en .env.local (DATABASE_URL + DB_SCHEMA).
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const { aplicarMigraciones } = await import("../lib/db/migrar");
await aplicarMigraciones();
console.log("migraciones al día");
process.exit(0);
