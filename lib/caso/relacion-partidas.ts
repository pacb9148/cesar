import { BAREMO, porId, type ItemBaremo } from "../engine/baremo";
import { SEMILLA, normClave } from "../conocimiento";
import { conjuntosQueContienen, type ExtrasMemoria } from "./partidas-evidencia";

/** Cuántas sugerencias se muestran de entrada; el resto se busca a mano. */
export const MAX_SUGERENCIAS = 5;

export type Accion = "retiro" | "reposicion" | "reparacion" | "preparacion" | "empaste" | "base" | "pintura" | "sello" | "limpieza" | "otra";
export type Objeto = "cielo" | "muro" | "cornisa" | "guardapolvo" | "piso" | "cubierta" | "puerta" | "ventana";

const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Qué se hace en la partida (se prueba en este orden: «pintura y sellos» es pintura, «retiro y reposición de sello» es sello). */
const ACCIONES: [Accion, RegExp][] = [
  ["empaste", /empaste/],
  ["base", /aparejo|imprimante|puente adherente|base /],
  ["pintura", /pintura|esmalte|barniz|pintar/],
  ["preparacion", /preparacion de superficie|lijado/],
  ["sello", /sello|sellado/],
  ["reparacion", /reparacion|fisura|grieta/],
  ["retiro", /retiro|desarme|demolicion|picado|remocion/],
  ["reposicion", /reposicion|reinstalacion|instalacion|suministro|provision|colocacion/],
  ["limpieza", /limpieza|aseo|flete|excedentes|botadero|escombro/],
];

const OBJETOS: [Objeto, RegExp][] = [
  ["cornisa", /cornisa|moldura/],
  ["guardapolvo", /guardapolvo/],
  ["cielo", /cielo|alero/],
  ["muro", /muro|pared|tabique|placa/],
  ["piso", /piso|pavimento|ceramic|radier|alfombra|flotante/],
  ["cubierta", /cubierta|zinc|teja|plancha|hojalater|osb|techumbre|caballete/],
  ["puerta", /puerta/],
  ["ventana", /ventana|vidrio/],
];

/** Acción y objetos de una descripción. «Yeso cartón»/«volcanita» sin más se aplica a cielo y muro (es la misma placa). */
export function etiquetasDe(descripcion: string): { accion: Accion; objetos: Set<Objeto> } {
  const d = sinTildes(descripcion);
  const accion = ACCIONES.find(([, re]) => re.test(d))?.[0] ?? "otra";
  const objetos = new Set<Objeto>(OBJETOS.filter(([, re]) => re.test(d)).map(([o]) => o));
  if (objetos.size === 0 && /yeso carton|volcanita|yeso-carton/.test(d)) {
    objetos.add("cielo");
    objetos.add("muro");
  }
  return { accion, objetos };
}

/** Objeto constructivo que nombra el elemento elegido en la ventana («Cielo», «Muro», «Guardapolvo»…). */
export const objetoDeElemento = (elemento: string): Objeto | null => etiquetasDe(elemento).objetos.values().next().value ?? null;

export type Sugerida = { id: number; descripcion: string; pu: number; motivo: string };

const claveDedup = (b: ItemBaremo) => `${normClave(b.descripcion)}|${b.pu}`;

/** Tipo de trabajo de una partida: acción y objetos («empaste de cielo»). Las variantes de un mismo trabajo (cielo madera, cielo yeso cartón…) no deben llenar la lista. */
const grupoDe = (b: ItemBaremo, soloAccion: boolean) => {
  const c = etiquetasDe(b.descripcion);
  if (soloAccion) return c.accion;
  // La placa (y sus variantes) cuenta como un solo trabajo; la cornisa y el guardapolvo, como otros.
  return `${c.accion}|${["cornisa", "guardapolvo"].find((x) => c.objetos.has(x as Objeto)) ?? "base"}`;
};

/**
 * Se queda con una sola partida por (descripción, precio) —la hoja Datos repite las mismas partidas con distinto número— y, con `porTrabajo`, con la mejor
 * de cada tipo de trabajo, para que las 5 sugerencias sean 5 trabajos distintos.
 */
function distintas<T extends { b: ItemBaremo; score: number }>(puntuadas: T[], porTrabajo: false | "accion" | "accion y objeto" = false): T[] {
  const vistas = new Set<string>();
  const trabajos = new Set<string>();
  const salida: T[] = [];
  for (const p of puntuadas.sort((a, c) => c.score - a.score || a.b.id - c.b.id)) {
    const k = claveDedup(p.b);
    if (vistas.has(k)) continue;
    vistas.add(k);
    if (porTrabajo) {
      const g = grupoDe(p.b, porTrabajo === "accion");
      if (trabajos.has(g)) continue;
      trabajos.add(g);
    }
    salida.push(p);
  }
  return salida;
}

const jaccard = (a: string, b: string) => {
  const x = new Set(normClave(a).split(" ").filter(Boolean));
  const y = new Set(normClave(b).split(" ").filter(Boolean));
  let i = 0;
  for (const t of x) if (y.has(t)) i++;
  return x.size + y.size - i === 0 ? 0 : i / (x.size + y.size - i);
};

// Qué acompaña a cada acción (prelación y complemento): retirar un revestimiento pide reponerlo, empastar, aparejar y pintar; empastar pide pintar, etc.
const COMPLEMENTO: Record<Accion, Partial<Record<Accion, number>>> = {
  retiro: { reposicion: 6, empaste: 5, pintura: 5, base: 3, preparacion: 2, limpieza: 2 },
  reposicion: { empaste: 6, pintura: 5, base: 3, preparacion: 2, retiro: 3, limpieza: 1 },
  empaste: { pintura: 6, base: 4, preparacion: 3 },
  base: { pintura: 6, empaste: 3 },
  pintura: { empaste: 5, base: 4, preparacion: 3 },
  preparacion: { empaste: 5, pintura: 5, base: 3 },
  reparacion: { empaste: 4, pintura: 5, preparacion: 3, base: 2 },
  sello: { pintura: 4, reparacion: 2 },
  limpieza: { pintura: 1 },
  otra: { pintura: 1 },
};
// Reparación básica de cada elemento (hoja Datos): preparación de superficie, empaste y pintura; en cubierta, retiro e instalación; etc.
const BASICAS: Partial<Record<Objeto, number[]>> = { cielo: [2, 3, 37], muro: [6, 7, 46], cubierta: [266, 267], piso: [247, 283], ventana: [273, 184], puerta: [181, 182] };

/** Partidas complementarias de la elegida, de la más a la menos relevante (sin la propia ni repetidas). Cada una es opcional para el usuario. */
export function complementosDe(id: number, o: { elemento?: string; extras?: ExtrasMemoria; max?: number } = {}): Sugerida[] {
  const principal = porId(id);
  if (!principal) return [];
  const { accion, objetos } = etiquetasDe(principal.descripcion);
  const elemento = objetoDeElemento(o.elemento ?? "");
  const base = new Set<Objeto>([...objetos, ...(elemento ? [elemento] : [])]);
  const conPlaca = base.has("cielo") || base.has("muro");
  const conjunto = new Set(conjuntosQueContienen(id));
  const juntas = SEMILLA.asociaciones?.[String(id)] ?? {};
  const aprendidas = new Set((o.extras?.[sinTildes(o.elemento ?? "").trim()] ?? []).map((x) => x.id));
  const pesos = COMPLEMENTO[accion];
  const estandar = new Set(Object.values(BASICAS).flat());
  const reponeORetira = accion === "retiro" || accion === "reposicion";

  const puntuadas = BAREMO.flatMap((b) => {
    if (b.id === id || normClave(b.descripcion) === normClave(principal.descripcion)) return [];
    const c = etiquetasDe(b.descripcion);
    // Accesorio de la placa: la cornisa va con el cielo y el muro; el guardapolvo, con el muro.
    const accesorio = (c.objetos.has("cornisa") && conPlaca) || (c.objetos.has("guardapolvo") && base.has("muro"));
    const comparte = [...c.objetos].some((x) => base.has(x));
    // Compatible: mismo objeto, un accesorio del cielo/muro (cornisa, guardapolvo) o una partida sin objeto (flete, aseo).
    if (c.objetos.size > 0 && !comparte && !accesorio) return [];
    // Sin objeto solo valen el flete y el aseo (o lo que los ajustes de referencia usaron junto a esta): lo demás es ruido de otras partidas.
    if (c.objetos.size === 0 && c.accion !== "limpieza" && !conjunto.has(b.id) && !juntas[String(b.id)] && !aprendidas.has(b.id)) return [];
    let score = (pesos[c.accion] ?? 0) * (accesorio ? 0.5 : 1);
    // Al retirar o reponer una placa de cielo o muro, sus cornisas se retiran y se reponen también.
    if (accesorio && reponeORetira && (c.accion === "retiro" || c.accion === "reposicion")) score = 4;
    if (score <= 0 && !conjunto.has(b.id) && !juntas[String(b.id)] && !aprendidas.has(b.id)) return [];
    if (conjunto.has(b.id)) score += 4;
    if (juntas[String(b.id)]) score += Math.min(juntas[String(b.id)], 8) / 2;
    if (aprendidas.has(b.id)) score += 3;
    if (estandar.has(b.id)) score += 1.5; // las partidas estándar de la reparación (empaste y lijado, pintura…) antes que sus variantes
    score += jaccard(principal.descripcion, b.descripcion) * 2;
    return [{ b, score }];
  });
  const motivo = (b: ItemBaremo) => {
    const c = etiquetasDe(b.descripcion);
    if (conjunto.has(b.id)) return "del mismo conjunto de reparación";
    if (juntas[String(b.id)]) return "usada junto a esta en tus ajustes de referencia";
    if (aprendidas.has(b.id)) return "la agregas habitualmente en este elemento";
    return c.accion === "otra" ? "complemento habitual" : `${c.accion} que suele acompañar`;
  };
  return distintas(puntuadas, "accion y objeto")
    .slice(0, o.max ?? MAX_SUGERENCIAS)
    .map(({ b }) => ({ id: b.id, descripcion: b.descripcion, pu: b.pu, motivo: motivo(b) }));
}

// Lo que sugiere cada tipo de daño del acta (humedad, manchas, fisuras…) como primera partida de reparación.
const DANOS: [RegExp, Partial<Record<Accion, number>>][] = [
  [/humedad|inflad|hinch|filtraci|escurr|gotera|pandeo|desprend|agua/, { retiro: 6, reposicion: 4, empaste: 3, pintura: 3, preparacion: 2 }],
  [/mancha|hongo|moho/, { preparacion: 4, pintura: 3 }],
  [/fisura|grieta|rajadura/, { reparacion: 5, sello: 2, empaste: 2 }],
];


/**
 * Partidas aplicables a un elemento (y al daño descrito del recinto, si se conoce), las 5 más relevantes: las que los ajustes de referencia y el usuario
 * usan en ese elemento, las de su reparación básica y las que corresponden al tipo de daño.
 */
export function aplicablesDe(o: { elemento: string; dano?: string; extras?: ExtrasMemoria; max?: number }): Sugerida[] {
  const objeto = objetoDeElemento(o.elemento);
  if (!objeto) return [];
  const claveElemento = sinTildes(o.elemento).trim();
  const uso = SEMILLA.elementos[claveElemento] ?? {};
  const aprendidas = new Set((o.extras?.[claveElemento] ?? []).map((x) => x.id));
  const basicas = new Set(BASICAS[objeto] ?? []);
  const dano = sinTildes(o.dano ?? "");
  const puntuadas = BAREMO.flatMap((b) => {
    const c = etiquetasDe(b.descripcion);
    if (!c.objetos.has(objeto)) return [];
    let score = Math.min(uso[String(b.id)] ?? 0, 8) / 4 + (aprendidas.has(b.id) ? 2 : 0) + (basicas.has(b.id) ? 3 : 0);
    // La humedad infla y suelta la placa de yeso cartón: lo normal es retirarla y reponerla.
    if (/humedad|inflad|hinch|pandeo|filtraci/.test(dano) && /yeso carton|volcanita/.test(sinTildes(b.descripcion))) score += 2;
    for (const [re, pesos] of DANOS) if (re.test(dano)) score += pesos[c.accion] ?? 0;
    if (/hongo|moho/.test(dano) && /hongo|moho/.test(sinTildes(b.descripcion))) score += 5;
    score += jaccard(o.dano ?? "", b.descripcion);
    return score > 0.5 ? [{ b, score }] : [];
  });
  return distintas(puntuadas, "accion")
    .slice(0, o.max ?? MAX_SUGERENCIAS)
    .map(({ b }) => ({ id: b.id, descripcion: b.descripcion, pu: b.pu, motivo: uso[String(b.id)] ? `la usas en ${claveElemento} en tus ajustes de referencia` : basicas.has(b.id) ? "reparación básica de este elemento" : "aplicable al daño descrito" }));
}

/** Búsqueda libre en la hoja Datos: todas las palabras escritas deben aparecer (aunque sea parte de una palabra); lo más corto primero. */
export function buscarPartidas(texto: string, max = 8): Sugerida[] {
  const palabras = sinTildes(texto).split(/[^a-z0-9]+/).filter((p) => p.length > 1);
  if (palabras.length === 0) return [];
  const encontradas = BAREMO.flatMap((b) => {
    const d = sinTildes(b.descripcion);
    return palabras.every((p) => d.includes(p)) ? [{ b, score: 100 - d.length }] : [];
  });
  return distintas(encontradas)
    .slice(0, max)
    .map(({ b }) => ({ id: b.id, descripcion: b.descripcion, pu: b.pu, motivo: "" }));
}
