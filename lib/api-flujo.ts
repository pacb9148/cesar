import { conTraza, type EventoTraza } from "./traza";

/**
 * Respuesta en flujo (una línea JSON por evento) para operaciones largas: el navegador ve cada paso mientras ocurre.
 * Líneas: `{traza: {…, t}}` por evento, y al final `{fin: resultado}` o `{falla: mensaje}`.
 */
export function respuestaFlujo<T>(fn: () => Promise<T>): Response {
  const t0 = Date.now();
  const enc = new TextEncoder();
  const cuerpo = new ReadableStream({
    async start(ctl) {
      const enviar = (o: unknown) => {
        try {
          ctl.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
        } catch {
          /* el cliente cerró la conexión: la operación sigue hasta terminar */
        }
      };
      try {
        const r = await conTraza((e: EventoTraza) => enviar({ traza: { ...e, t: Date.now() - t0 } }), fn);
        enviar({ fin: r });
      } catch (e) {
        console.error("[flujo]", e);
        enviar({ traza: { tipo: "error", paso: "error", texto: e instanceof Error ? e.message : "Error inesperado", t: Date.now() - t0 } });
        enviar({ falla: e instanceof Error ? e.message : "Error inesperado" });
      } finally {
        try {
          ctl.close();
        } catch {
          /* ya cerrado */
        }
      }
    },
  });
  return new Response(cuerpo, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
