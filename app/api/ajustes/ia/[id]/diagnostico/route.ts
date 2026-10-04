import { conUsuario } from "@/lib/api";
import { respuestaFlujo } from "@/lib/api-flujo";
import { crearCliente } from "@/lib/ia/proveedores";
import { configDe, destinoDe, listarProveedores } from "@/lib/ia/repo-proveedores";
import { probarYRegistrar } from "@/lib/ia/servicio-proveedores";
import { emitir } from "@/lib/traza";

export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * Prueba un proveedor paso a paso y en vivo: configuración, prueba simple (la que hace cualquier cliente de chat) y una segunda
 * prueba por la misma ruta que usa el ajuste (salida estructurada, tope alto, instrucciones largas). Si la primera pasa y la
 * segunda no, el problema está en cómo el modelo responde a la petición del agente, no en la red ni en la clave.
 */
export const POST = conUsuario<{ id: string }>(async (_req, u, { id }) =>
  respuestaFlujo(async () => {
    const cfg = await configDe(u.id, id);
    if (!cfg) throw new Error("Proveedor no encontrado.");
    emitir("info", "config", `${cfg.nombre}: modelo «${cfg.modelo}», destino ${destinoDe(cfg.tipo, cfg.baseUrl)}, clave …${cfg.clave.slice(-4)} (la clave nunca se muestra completa)`);
    emitir("info", "prueba 1", "Prueba simple de chat (red, clave y modelo)");
    const prueba = await probarYRegistrar(u.id, id);
    emitir(prueba.ok ? "ok" : "error", "prueba 1", prueba.ok ? `Superada en ${(prueba.ms / 1000).toFixed(1)} s` : `Falló: ${prueba.error}`);
    let estructurada: { ok: boolean; ms: number; error?: string } | null = null;
    if (prueba.ok) {
      emitir("info", "prueba 2", "Prueba con la ruta del agente: instrucciones largas, esquema JSON y tope de salida alto (sin fotos)");
      const t0 = Date.now();
      try {
        const r = await crearCliente(cfg).generarJson({
          system: "Eres un asistente de pruebas. Responde ÚNICAMENTE con un objeto JSON.",
          partes: [{ text: "Devuelve exactamente este JSON: {\"estado\":\"ok\"}" }],
          schema: { type: "object", properties: { estado: { type: "string" } }, required: ["estado"] },
        });
        estructurada = { ok: true, ms: Date.now() - t0 };
        emitir("ok", "prueba 2", `Superada en ${((Date.now() - t0) / 1000).toFixed(1)} s`, r.texto.slice(0, 400));
      } catch (e) {
        estructurada = { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : "Error" };
        emitir("error", "prueba 2", `Falló: ${estructurada.error}`);
      }
    }
    return { prueba, estructurada, proveedores: await listarProveedores(u.id) };
  }),
);
