import { ErrorHttp, esClaveInvalida } from "./red-segura";
import type { ClienteLlm, RespuestaLlm } from "./gemini";
import { emitir } from "../traza";

export type Candidato = { id: string | null; nombre: string; cliente: ClienteLlm; fallosSeguidos: number; pausado: boolean; detalle?: string };

export type InfoFallo = { error: string; pausaS: number; desactivar: boolean };

/** Persistencia del estado de salud de cada proveedor; en las pruebas se sustituye por una versión en memoria. */
export interface RegistroSalud {
  candidatos(): Promise<Candidato[]>;
  ok(id: string | null): Promise<void>;
  fallo(id: string | null, info: InfoFallo): Promise<void>;
}

const MAX_PAUSA_S = 60 * 60;

/** Anthropic responde 400 «credit balance is too low»; otros, 402 o «insufficient_quota»: es un problema de facturación, no de la petición. */
export const esFaltaDeSaldo = (e: ErrorHttp): boolean => e.estado === 402 || /credit balance|insufficient[_ ](quota|funds|credits?)|billing|exceeded your current quota/i.test(e.message);

/**
 * Qué hacer con un proveedor que falló:
 *  - sin respuesta, 408, 5xx (incluye 529 «sobrecargado»): indisponibilidad momentánea → pausa corta que crece con los fallos seguidos;
 *  - 429: límite de uso → pausa según Retry-After (o 5 min);
 *  - 401/403: la clave no sirve → se desactiva hasta que el usuario la corrija;
 *  - 400/404/422: configuración o petición rechazada → se salta y se pausa 10 min, sin desactivarlo del todo.
 */
export function clasificarFallo(e: unknown, fallosSeguidos: number): InfoFallo {
  if (!(e instanceof ErrorHttp)) return { error: e instanceof Error ? e.message.slice(0, 250) : "Error desconocido", pausaS: 60, desactivar: false };
  const e2 = Math.min(MAX_PAUSA_S, 30 * 2 ** Math.min(fallosSeguidos, 7));
  if (esClaveInvalida(e)) return { error: e.message, pausaS: MAX_PAUSA_S, desactivar: true };
  if (e.estado === 429) return { error: `Límite de uso del proveedor (cuota): ${e.message}`, pausaS: Math.min(MAX_PAUSA_S, e.reintentarDespuesS ?? segundosEnMensaje(e.message) ?? 60), desactivar: false };
  if (esFaltaDeSaldo(e)) return { error: `Sin saldo o crédito en la cuenta del proveedor: recárgalo en su panel de facturación (${e.message})`, pausaS: 300, desactivar: false };
  if (e.estado === 400 || e.estado === 404 || e.estado === 410 || e.estado === 422) return { error: e.message, pausaS: 600, desactivar: false };
  return { error: e.message, pausaS: Math.min(MAX_PAUSA_S, e.reintentarDespuesS ?? e2), desactivar: false };
}

/** Gemini avisa «Please retry in 23.4s» en el cuerpo del 429. */
const segundosEnMensaje = (m: string): number | undefined => {
  const x = /retry in ([\d.]+)\s*s/i.exec(m);
  return x ? Math.ceil(Number(x[1])) : undefined;
};

/** Espera máxima (s) para reanudar solo cuando todos los proveedores fallaron por algo momentáneo; si pide más, se detiene y el avance queda guardado. */
const ESPERA_MAX_S = 90;

class TodosFallaron extends Error {
  constructor(
    mensaje: string,
    public esperaS: number | null,
  ) {
    super(mensaje);
  }
}

export class SinProveedores extends Error {
  constructor() {
    super("No hay ningún proveedor de IA activo: agrega uno en «Ajustes de IA» y espera a que su prueba salga correcta.");
  }
}

/**
 * Cliente con respaldo automático: prueba los proveedores en orden de prioridad y, si uno no responde,
 * salta al siguiente en la misma petición. Los que fallaron quedan en pausa para que las siguientes llamadas no pierdan tiempo con ellos;
 * si todos están en pausa se vuelven a intentar igualmente (el servicio puede haberse recuperado).
 */
export class ClienteConRespaldo implements ClienteLlm {
  /** `esperas`: cuántas veces puede esperar y reintentar cuando todos fallan por un límite momentáneo (0 = no espera). */
  constructor(
    private registro: RegistroSalud,
    private esperas = 0,
    private dormir: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async generarJson(o: Parameters<ClienteLlm["generarJson"]>[0]): Promise<RespuestaLlm> {
    for (let n = 0; ; n++) {
      try {
        return await this.probarTodos(o);
      } catch (e) {
        const espera = e instanceof TodosFallaron ? e.esperaS : null;
        if (espera == null || n >= this.esperas) throw e;
        emitir("info", "ia", `Ningún proveedor respondió por un límite momentáneo: se espera ${espera} s y se reintenta (${n + 1}/${this.esperas}); lo ya leído sigue guardado`);
        await this.dormir(espera * 1000);
      }
    }
  }

  private async probarTodos(o: Parameters<ClienteLlm["generarJson"]>[0]): Promise<RespuestaLlm> {
    const lista = await this.registro.candidatos();
    if (lista.length === 0) throw new SinProveedores();
    const incidencias: string[] = [];
    const pausas: number[] = [];
    let todasMomentaneas = true;
    emitir("info", "ia", `${lista.length} proveedor(es) disponible(s), por orden de prioridad: ${lista.map((c) => c.nombre).join(" → ")}`);
    for (const [i, c] of lista.entries()) {
      emitir("info", "ia", `Proveedor ${i + 1}/${lista.length}: ${c.nombre}${c.detalle ? ` (${c.detalle})` : ""}${c.pausado ? " — estaba en pausa por un fallo previo; se reintenta igualmente" : ""}`);
      try {
        const r = await c.cliente.generarJson(o);
        await this.registro.ok(c.id);
        emitir("ok", "ia", `${c.nombre} respondió${r.tokensEntrada ? ` (${r.tokensEntrada} tokens de entrada, ${r.tokensSalida ?? "?"} de salida)` : ""}`);
        return {
          ...r,
          modelo: `${c.nombre} · ${r.modelo}`,
          avisos: [...incidencias.map((i) => `Se pasó al siguiente proveedor: ${i}`), ...(r.avisos ?? [])],
        };
      } catch (e) {
        const info = clasificarFallo(e, c.fallosSeguidos);
        await this.registro.fallo(c.id, info);
        emitir("error", "ia", `${c.nombre} falló: ${info.error}`, `${info.desactivar ? "Se desactiva hasta corregir la clave." : `Queda en pausa ${info.pausaS} s.`}${i < lista.length - 1 ? " Se pasa al siguiente proveedor." : " No quedan más proveedores."}`);
        incidencias.push(`${c.nombre} no respondió (${info.error})`);
        pausas.push(info.pausaS);
        if (info.desactivar || info.pausaS > ESPERA_MAX_S) todasMomentaneas = false;
      }
    }
    throw new TodosFallaron(`Ningún proveedor de IA respondió. ${incidencias.join(" | ")}`, todasMomentaneas ? Math.max(5, Math.min(...pausas)) : null);
  }
}
