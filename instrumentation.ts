/** Al arrancar el servidor (no durante `next build`) deja la base al día con las migraciones. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.DATABASE_URL && process.env.DB_MODE !== "pglite") return;
  try {
    const { aplicarMigraciones } = await import("./lib/db/migrar");
    await aplicarMigraciones();
  } catch (e) {
    // No se tumba el servidor: el error queda en el log y las rutas fallarán con un mensaje claro.
    console.error("[migraciones] no se pudieron aplicar:", e instanceof Error ? e.message : e);
  }
}
