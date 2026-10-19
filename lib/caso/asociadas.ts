import type { LineaAdicional, Unidad } from "../domain/tipos";
import { porId } from "../engine/baremo";
import { SEMILLA } from "../conocimiento";
import { coincideEstancia } from "../fotos/orden";
import { conjuntosQueContienen, type ExtrasMemoria } from "./partidas-evidencia";

const UNIDADES: readonly Unidad[] = ["m2", "ml", "gl", "un", "m3", "kg"];
const esUnidad = (x: string): x is Unidad => (UNIDADES as readonly string[]).includes(x);
const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// La hoja Datos no trae unidad de medida: se toma la que los ajustes de referencia usaron con cada partida y, si no se vio, la que sugiere la descripción.
const REGLAS_UM: [RegExp, Unidad][] = [
  [/flete|aseo|andamio|arriendo|traslado|medios auxiliares|proteccion|limpieza general|gastos generales|retiro de excedentes/, "gl"],
  [/guardapolvo|cornisa|moldura|canal|bajada|hojalateria|perfil|zocalo|cubrejunta|junquillo|pilastra|baranda/, "ml"],
  [/puerta|ventana|vidrio|cerradura|chapa|bisagra|manilla|enchufe|interruptor|artefacto|lavamanos|inodoro|wc|tina|ducha|griferia|lampara|foco|cuadratura|rejilla|persiana|espejo/, "un"],
  [/hormigon|relleno|excavacion|escombro/, "m3"],
];

/** Unidad de medida de una partida de la hoja Datos. */
export function umDe(id: number): Unidad {
  const aprendida = SEMILLA.um?.[String(id)];
  if (aprendida && esUnidad(aprendida)) return aprendida;
  const d = sinTildes(porId(id)?.descripcion ?? "");
  return REGLAS_UM.find(([re]) => re.test(d))?.[1] ?? "m2";
}

/** Observaciones con que se agrega una partida de la hoja Datos: precio de baremo (B) y, si se mide por superficie, cantidad según el acta (C). */
export const obsPorDefecto = (um: Unidad): LineaAdicional["obs"] => (um === "m2" ? ["B", "C"] : ["B"]);

export type Asociada = { id: number; descripcion: string; um: Unidad; pu: number; origen: "complemento" | "conjunto" | "aprendido"; veces: number };

/**
 * Partidas que suelen ir junto a otra (prelación o complemento), todas con LA MISMA unidad de medida: las que los ajustes de referencia usaron juntas en la
 * misma estancia y elemento, las del mismo conjunto de reparación (preparación, empaste, pintura…) y las que el usuario suele agregar en ese elemento.
 */
export function asociadasDe(id: number, o: { um?: Unidad; elemento?: string; extras?: ExtrasMemoria } = {}): Asociada[] {
  const um = o.um ?? umDe(id);
  const mapa = new Map<number, Asociada>();
  const poner = (otro: number, origen: Asociada["origen"], veces: number, umPropia?: string) => {
    const b = porId(otro);
    if (otro === id || mapa.has(otro) || !b) return;
    const u = umPropia && esUnidad(umPropia) ? umPropia : umDe(otro);
    if (u !== um) return;
    mapa.set(otro, { id: otro, descripcion: b.descripcion, um: u, pu: b.pu, origen, veces });
  };
  for (const [k, n] of Object.entries(SEMILLA.asociaciones?.[String(id)] ?? {}).sort((a, b) => b[1] - a[1])) poner(Number(k), "complemento", n);
  for (const otro of conjuntosQueContienen(id)) poner(otro, "conjunto", 0);
  const elemento = sinTildes(o.elemento ?? "").trim();
  for (const x of o.extras?.[elemento] ?? []) poner(x.id, "aprendido", 0, x.um);
  return [...mapa.values()].slice(0, 12);
}

/** Partida lista para el ajuste a partir de lo elegido en la ventana de inserción; con `baremoId` toma el precio de la hoja Datos como origen. */
export function partidaNueva(p: { recinto: string; elemento?: string; descripcion: string; um: Unidad; cantidad: number; pu: number; obs: LineaAdicional["obs"]; baremoId?: number | null }): LineaAdicional {
  return {
    seccion: p.recinto.trim().toUpperCase(),
    elemento: p.elemento?.trim() || undefined,
    descripcion: p.descripcion.trim(),
    um: p.um,
    cantidad: p.cantidad,
    pu: p.pu,
    pu_origen: p.baremoId ? `baremo:${p.baremoId}` : "mercado:manual",
    obs: p.obs,
    justificacion: "Partida insertada por el liquidador.",
  };
}

/**
 * Inserta las partidas nuevas a continuación de la última partida registrada de su recinto (la igualdad exacta manda; si no, la estancia que la contiene).
 * Si el recinto aún no tiene partidas, van al final. Conserva el orden de lo demás.
 */
export function insertarDespuesDelRecinto(lineas: LineaAdicional[], nuevas: LineaAdicional[]): LineaAdicional[] {
  if (nuevas.length === 0) return lineas;
  const seccion = nuevas[0].seccion.trim().toUpperCase();
  let ultimo = -1;
  lineas.forEach((l, i) => {
    if (l.seccion.trim().toUpperCase() === seccion) ultimo = i;
  });
  if (ultimo < 0)
    lineas.forEach((l, i) => {
      if (coincideEstancia(l.seccion, seccion)) ultimo = i;
    });
  if (ultimo < 0) return [...lineas, ...nuevas];
  return [...lineas.slice(0, ultimo + 1), ...nuevas, ...lineas.slice(ultimo + 1)];
}
