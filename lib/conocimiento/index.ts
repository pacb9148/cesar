import semillaJson from "./semilla.json";
import { normClave } from "./normalizar";

export { normClave, elementoDe, type Elemento } from "./normalizar";

/** Memoria del sistema: lo aprendido de los ajustes de referencia (semilla) y de cada ajuste que el usuario guarda. */
export type Semilla = {
  partidas: Record<string, Record<string, number>>;
  elementos: Record<string, Record<string, number>>;
  secciones: Record<string, number>;
  estancias: Record<string, number>;
  lineas: number;
  asociadas: number;
};
export const SEMILLA = semillaJson as unknown as Semilla;

/** Lo aprendido de los ajustes del usuario: una partida del presupuesto → qué partida de la hoja Datos se le asignó, y qué partidas agrega por elemento. */
export type Aprendido = {
  partidas: Map<string, Map<number, number>>;
  elementos: Map<string, { secciones: number; ids: Map<number, { veces: number; um: string }> }>;
};
export const aprendidoVacio = (): Aprendido => ({ partidas: new Map(), elementos: new Map() });

const mejor = (m: Map<number, number> | undefined): number | null => {
  if (!m || m.size === 0) return null;
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
};

/**
 * Partida de la hoja Datos que corresponde a una descripción de presupuesto, según la memoria: primero lo que el usuario ya asignó antes y, si no hay,
 * lo que se aprendió de los ajustes de referencia. null si nunca se vio algo parecido (entonces decide la similitud de palabras o la IA).
 */
export function baremoSugerido(a: Aprendido, descripcion: string): number | null {
  const k = normClave(descripcion);
  const propio = mejor(a.partidas.get(k));
  if (propio !== null) return propio;
  const s = SEMILLA.partidas[k];
  if (!s) return null;
  return mejor(new Map(Object.entries(s).map(([id, n]) => [Number(id), n])));
}

/** Partidas que el usuario suele agregar en un elemento (cielo, muro…) además de las de base: las usadas en al menos la mitad de sus estancias y dos veces o más. */
export function extrasDeElemento(a: Aprendido, elemento: string, base: number[]): { id: number; um: string }[] {
  const e = a.elementos.get(elemento);
  if (!e || e.secciones < 2) return [];
  return [...e.ids.entries()].filter(([id, v]) => !base.includes(id) && v.veces >= 2 && v.veces / e.secciones >= 0.5).map(([id, v]) => ({ id, um: v.um }));
}

/** Resumen para la pantalla: tamaño de la memoria y de dónde viene. */
export function resumenConocimiento(a: Aprendido) {
  return {
    semilla: { descripciones: Object.keys(SEMILLA.partidas).length, lineas: SEMILLA.lineas, asociadas: SEMILLA.asociadas },
    aprendido: { descripciones: a.partidas.size, elementos: a.elementos.size },
  };
}
