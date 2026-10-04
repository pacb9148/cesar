import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Registro de actividad de una operación larga (leer documentos, llamar a la IA, generar el informe) para mostrarlo en pantalla
 * mientras ocurre. Se propaga con AsyncLocalStorage: cualquier capa llama a `emitir` sin recibir nada por parámetro, y si nadie
 * escucha no hace nada. Nunca debe recibir claves ni cabeceras de autorización.
 */
export type EventoTraza = { tipo: "info" | "ok" | "error" | "espera"; paso: string; texto: string; detalle?: string };
export type Emisor = (e: EventoTraza) => void;

// En globalThis: el empaquetador puede duplicar este módulo entre rutas y el contexto no se vería.
const g = globalThis as unknown as { __trazaAls?: AsyncLocalStorage<Emisor> };
const als = (g.__trazaAls ??= new AsyncLocalStorage<Emisor>());

export const conTraza = <T>(emisor: Emisor, fn: () => Promise<T>): Promise<T> => als.run(emisor, fn);
export const emitir = (tipo: EventoTraza["tipo"], paso: string, texto: string, detalle?: string): void => {
  try {
    als.getStore()?.({ tipo, paso, texto, detalle });
  } catch {
    /* el registro nunca debe romper la operación */
  }
};

/** Resumen legible de un cuerpo JSON para mostrarlo: recorta textos largos, oculta imágenes en base64 y limita la profundidad. */
export function vistaPrevia(valor: unknown, profundidad = 0): unknown {
  if (typeof valor === "string") {
    if (valor.startsWith("data:") || (valor.length > 2000 && /^[A-Za-z0-9+/=]+$/.test(valor.slice(0, 200)))) return `[datos binarios ${Math.round(valor.length / 1024)} KB]`;
    return valor.length > 240 ? `${valor.slice(0, 200)}… (${valor.length} caracteres)` : valor;
  }
  if (Array.isArray(valor)) {
    const v = valor.slice(0, 4).map((x) => vistaPrevia(x, profundidad + 1));
    return valor.length > 4 ? [...v, `… (+${valor.length - 4} elementos)`] : v;
  }
  if (valor && typeof valor === "object") {
    if (profundidad >= 4) return "{…}";
    return Object.fromEntries(Object.entries(valor).map(([k, x]) => [k, vistaPrevia(x, profundidad + 1)]));
  }
  return valor;
}
