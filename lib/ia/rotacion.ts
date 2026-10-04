import { ErrorHttp, esClaveInvalida } from "./red-segura";
import type { ClienteLlm, RespuestaLlm } from "./gemini";

export type Candidato = { id: string | null; nombre: string; cliente: ClienteLlm; fallosSeguidos: number; pausado: boolean };

export type InfoFallo = { error: string; pausaS: number; desactivar: boolean };

/** Persistencia del estado de salud de cada proveedor; en las pruebas se sustituye por una versión en memoria. */
export interface RegistroSalud {
  candidatos(): Promise<Candidato[]>;
  ok(id: string | null): Promise<void>;
  fallo(id: string | null, info: InfoFallo): Promise<void>;
}

const MAX_PAUSA_S = 60 * 60;

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
  if (e.estado === 429) return { error: e.message, pausaS: Math.min(MAX_PAUSA_S, e.reintentarDespuesS ?? 300), desactivar: false };
  if (e.estado === 400 || e.estado === 404 || e.estado === 410 || e.estado === 422) return { error: e.message, pausaS: 600, desactivar: false };
  return { error: e.message, pausaS: Math.min(MAX_PAUSA_S, e.reintentarDespuesS ?? e2), desactivar: false };
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
  constructor(private registro: RegistroSalud) {}

  async generarJson(o: Parameters<ClienteLlm["generarJson"]>[0]): Promise<RespuestaLlm> {
    const lista = await this.registro.candidatos();
    if (lista.length === 0) throw new SinProveedores();
    const incidencias: string[] = [];
    for (const c of lista) {
      try {
        const r = await c.cliente.generarJson(o);
        await this.registro.ok(c.id);
        return {
          ...r,
          modelo: `${c.nombre} · ${r.modelo}`,
          avisos: [...incidencias.map((i) => `Se pasó al siguiente proveedor: ${i}`), ...(r.avisos ?? [])],
        };
      } catch (e) {
        const info = clasificarFallo(e, c.fallosSeguidos);
        await this.registro.fallo(c.id, info);
        incidencias.push(`${c.nombre} no respondió (${info.error})`);
      }
    }
    throw new Error(`Ningún proveedor de IA respondió. ${incidencias.join(" | ")}`);
  }
}
