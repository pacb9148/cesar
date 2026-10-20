import { BAREMO, porId, type ItemBaremo } from "../engine/baremo";
import { baremoSugerido, normClave, type Aprendido } from "../conocimiento";
import type { Unidad } from "../domain/tipos";
import { umDe } from "./asociadas";
import { etiquetasDe } from "./relacion-partidas";

/**
 * Equivalencias entre las partidas de un presupuesto y la hoja Datos (baremo). Los contratistas describen el mismo trabajo con otras palabras
 * («Raspar, enhuinchar y lijar cielo yeso cartón» es «Preparación de Superficie Cielo»), así que no basta comparar palabras sueltas: cada descripción
 * se clasifica por lo que se hace (acción) y sobre qué (objeto), se comparan sus palabras ya normalizadas con sinónimos y se verifican material y unidad.
 * Solo una equivalencia de confianza ALTA permite ajustar el precio; lo que no se reconoce se deja tal cual (nunca se inventa un valor).
 */

export type Equivalente = { id: number; descripcion: string; pu: number; score: number; confianza: "alta" | "media"; motivo: string };

const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Palabras que significan lo mismo en un presupuesto de obra: se reducen a una sola para comparar.
const SINONIMOS: [RegExp, string | ((m: string) => string)][] = [
  [/\b(enhuinch\w*|raspar|raspado|rasqueteo|limpieza y preparacion|preparacion de superficie|lijado|lijar)\b/g, " preparacion "],
  [/\b(extraccion|desmontaje|desarme|demolicion|picado|remocion|retiro)\b/g, " retiro "],
  [/\b(suministro e instalacion|provision y colocacion|reinstalacion|reposicion|instalacion|colocacion|provision)\b/g, " reposicion "],
  [/\b(pintura|pintar|esmalte al agua|esmalte|latex|barniz)\b/g, " pintura "],
  [/\b(aparejo|sipa|imprimante|puente adherente|sellador)\b/g, " base "],
  [/\b(volcanita|yeso carton|yeso-carton|plancha de yeso|placa de yeso|cartonyeso|carton yeso|yeso)\b/g, " yesocarton "],
  [/\b(cielorraso|cielo raso)\b/g, " cielo "],
  [/\b(pared|paredes|tabique|paramento)\b/g, " muro "],
  [/\b(muros|cielos|cornisas|guardapolvos|puertas|ventanas|pisos)\b/g, (m: string) => ` ${m.slice(0, -1)} `],
];
const VACIAS = new Set(["de", "del", "la", "el", "en", "y", "e", "con", "para", "por", "al", "los", "las", "a", "total", "incluye", "manos", "mano", "obra", "todo", "costo"]);

function tokens(texto: string): Set<string> {
  let t = ` ${sinTildes(texto).replace(/[^a-z0-9 ]+/g, " ")} `;
  for (const [re, por] of SINONIMOS) t = t.replace(re, por as string);
  return new Set(t.split(" ").filter((x) => x.length > 1 && !VACIAS.has(x)));
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return a.size + b.size - i === 0 ? 0 : i / (a.size + b.size - i);
};

// Materiales: dos partidas de materiales distintos (madera / yeso cartón) no son equivalentes aunque hagan lo mismo.
const MATERIALES = ["yesocarton", "osb", "madera", "zinc", "teja", "ceramica", "vinilico", "laminado", "flotante", "hormigon", "aluminio", "vidrio", "pvc", "policarbonato", "fibrocemento", "papel", "terciado"];

const claveCatalogo = (b: ItemBaremo) => `${normClave(b.descripcion)}|${b.pu}`;
const TOKENS_BAREMO = new Map<number, Set<string>>(BAREMO.map((b) => [b.id, tokens(b.descripcion)]));

const UMBRAL_ALTA = 9;
const UMBRAL_MEDIA = 6;

function puntuar(descripcion: string, um: Unidad | undefined, tk: Set<string>, b: ItemBaremo): { score: number; motivo: string } | null {
  const a = etiquetasDe(descripcion);
  const c = etiquetasDe(b.descripcion);
  const compartidos = [...a.objetos].filter((o) => c.objetos.has(o)).length;
  // Si ambas nombran objeto y no coinciden en ninguno (cielo vs piso), no es lo mismo.
  if (a.objetos.size > 0 && c.objetos.size > 0 && compartidos === 0) return null;
  let score = 0;
  const motivos: string[] = [];
  if (a.accion !== "otra" && a.accion === c.accion) {
    score += 4;
    motivos.push(a.accion);
  } else if (a.accion !== "otra" && c.accion !== "otra") score -= 3;
  if (compartidos > 0) {
    score += 3 + compartidos / Math.max(a.objetos.size, c.objetos.size);
    motivos.push([...a.objetos].filter((o) => c.objetos.has(o)).join("/"));
  }
  const tb = TOKENS_BAREMO.get(b.id) ?? tokens(b.descripcion);
  score += jaccard(tk, tb) * 5;
  const mat = MATERIALES.filter((m) => tk.has(m) || tb.has(m));
  let coinciden = 0;
  for (const m of mat) {
    if (tk.has(m) && tb.has(m)) coinciden++;
    else score -= 1.5;
  }
  score += Math.min(coinciden, 2);
  if (um && umDe(b.id) !== um) score -= 4;
  return { score, motivo: motivos.join(" · ") };
}

/**
 * Partidas de la hoja Datos equivalentes a una descripción de presupuesto, de la más a la menos parecida, sin repetidas (la hoja repite partidas con distinto
 * número). `alta` = mismo trabajo sobre lo mismo, mismo material y misma unidad (o lo que el sistema ya aprendió); `media` = parecida, solo para sugerir.
 */
export function equivalentesDe(descripcion: string, o: { um?: Unidad; memoria?: Aprendido; max?: number } = {}): Equivalente[] {
  const tk = tokens(descripcion);
  if (tk.size === 0) return [];
  const sugerido = o.memoria ? baremoSugerido(o.memoria, descripcion) : null;
  const puntuadas = BAREMO.flatMap((b) => {
    const p = puntuar(descripcion, o.um, tk, b);
    if (!p) return [];
    const porMemoria = sugerido === b.id;
    const score = p.score + (porMemoria ? 10 : 0);
    return score >= UMBRAL_MEDIA ? [{ b, score, motivo: porMemoria ? "ya asignada antes a esta descripción" : p.motivo }] : [];
  });
  const vistas = new Set<string>();
  const salida: Equivalente[] = [];
  for (const x of puntuadas.sort((a, c) => c.score - a.score || a.b.id - c.b.id)) {
    const k = claveCatalogo(x.b);
    if (vistas.has(k)) continue;
    vistas.add(k);
    salida.push({ id: x.b.id, descripcion: x.b.descripcion, pu: x.b.pu, score: Math.round(x.score * 100) / 100, confianza: x.score >= UMBRAL_ALTA ? "alta" : "media", motivo: x.motivo });
    if (salida.length >= (o.max ?? 5)) break;
  }
  return salida;
}

/** La equivalencia de confianza alta más parecida, o null si no hay una segura (entonces la partida se deja tal cual). */
export function mejorEquivalente(descripcion: string, o: { um?: Unidad; memoria?: Aprendido } = {}): Equivalente | null {
  const e = equivalentesDe(descripcion, { ...o, max: 1 })[0];
  return e && e.confianza === "alta" && porId(e.id) ? e : null;
}
