import type { ActaInspeccion, DanoActa } from "../extraccion/acta";
import { descripcionPericial, type Elemento } from "./lexico-pericial";
import { elementosDeHechos } from "./partidas-evidencia";

type ConExtras = ActaInspeccion & { tipoInmueble?: string | null; causa?: string | null };

const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unir = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

export type ValoresInmueble = { pisos?: unknown; superficie?: unknown; antiguedad?: unknown; dormitorios?: unknown; banos?: unknown; sistema?: unknown; techumbre?: unknown; cubierta?: unknown; pavimentos?: unknown };

const FALTA = "[FALTA DATO: Rellenar con XXX]";
const vacio = (v: unknown) => v == null || String(v).trim() === "";
const texto = (v: unknown) => (vacio(v) ? FALTA : String(v).trim());
const cuenta = (v: unknown, uno: string, varios: string) => (vacio(v) ? `${FALTA} ${varios}` : `${texto(v)} ${Number(v) === 1 ? uno : varios}`);
/** Quita el encabezado repetido de un valor del acta («Estructura de madera» → «madera»), en minúsculas. */
const sin = (v: unknown, re: RegExp) => (vacio(v) ? FALTA : String(v).trim().replace(re, "").toLowerCase());

/**
 * Párrafo «Características del bien en riesgo» con la redacción de la plantilla del informe, ya con los valores de la inspección:
 * «Vivienda de 2 pisos de uso exclusivo habitacional con una superficie construida de 90 m² y una antigüedad de 7 años. Consta de 3 dormitorios,
 * 2 baños, cocina, living comedor, entre otras dependencias.» y, en otro párrafo, «Edificación de madera, techumbre soportada por cerchas de madera, …».
 * Lo que no consta queda marcado como [FALTA DATO]. Los dos párrafos van separados por una línea en blanco.
 */
export function parrafoPlantilla(v: ValoresInmueble): string {
  const primero =
    `Vivienda de ${cuenta(v.pisos, "piso", "pisos")} de uso exclusivo habitacional con una superficie construida de ${texto(v.superficie)} m² y una antigüedad de ${cuenta(v.antiguedad, "año", "años")}. ` +
    `Consta de ${cuenta(v.dormitorios, "dormitorio", "dormitorios")}, ${cuenta(v.banos, "baño", "baños")}, cocina, living comedor, entre otras dependencias.`;
  const segundo =
    `Edificación de ${sin(v.sistema, /^estructura( de)?\s*/i)}, techumbre soportada por ${sin(v.techumbre, /^(estructura|techumbre)( de)?\s*/i)}, cubierta de ${sin(v.cubierta, /^cubierta( de)?\s*/i)}, ` +
    `revestimientos en muros y cielo con pinturas y pavimentos de ${sin(v.pavimentos, /^pavimentos?( de)?\s*/i)}.`;
  return `${primero}\n\n${segundo}`;
}

/** Lo mismo, directamente desde la inspección (cuando aún no hay un ajuste con las características). Devuelve «» si la inspección no trae nada del inmueble. */
export function parrafoInmueble(a: ConExtras): string {
  if (!a.pisos && !a.dormitorios && !a.banos && !a.antiguedad && !a.superficieM2 && !a.sistemaEstructural && !a.estructuraTechumbre && !a.cubierta && !a.pavimentos) return "";
  return parrafoPlantilla({ pisos: a.pisos, superficie: a.superficieM2, antiguedad: a.antiguedad, dormitorios: a.dormitorios, banos: a.banos, sistema: a.sistemaEstructural, techumbre: a.estructuraTechumbre, cubierta: a.cubierta, pavimentos: a.pavimentos });
}

const ELEMENTOS: [RegExp, string][] = [
  [/cielo/i, "cielo"],
  [/pared|muro|tabique/i, "muro"],
  [/cubierta|techumbre|techo/i, "cubierta"],
  [/piso|pavimento|radier/i, "piso"],
  [/ventana|vidrio/i, "ventana"],
  [/puerta/i, "puerta"],
];

/**
 * Viñeta de la evidencia de un recinto a partir de la tabla «Daños y perjuicios», en lenguaje técnico pericial cuando el acta lo sustenta
 * («Huella de filtración en cielo (mácula oscura por ingreso de agua en el entrepiso), con escurrimiento (…).»). Si el elemento no consta en el acta, se toma de los
 * hechos del siniestro. Cuando el texto no permite precisar el daño, queda la redacción simple: «Muro afectado por humedad.», «Cielo y muro afectado por humedad.».
 */
export function vinetaDeDano(d: Pick<DanoActa, "descripcion" | "tipoDano"> & { recinto?: string }, hechos?: string | null): string {
  const contexto = elementosDeHechos(hechos, d.recinto ?? "").map((e): Elemento => (e === "ventana" || e === "puerta" ? "accesorio" : e));
  const pericial = descripcionPericial(`${d.descripcion} ${d.tipoDano ?? ""}`, contexto);
  return ampliar(pericial ?? vinetaSimple(d));
}

/** Frase algo más larga y natural: «Se observa …, según consta en el acta de inspección.» («consta», no «registrado»: así no se confunde con las viñetas automáticas antiguas). */
function ampliar(frase: string): string {
  const sinPunto = frase.trim().replace(/\.$/, "");
  return `Se observa ${sinPunto.charAt(0).toLowerCase()}${sinPunto.slice(1)}, según consta en el acta de inspección.`;
}

/** Redacción simple de la viñeta (sin léxico técnico): elementos nombrados + tipo de daño. */
function vinetaSimple(d: Pick<DanoActa, "descripcion" | "tipoDano">): string {
  const desc = d.descripcion.toLowerCase();
  const hallados = ELEMENTOS.map(([re, nombre]) => ({ nombre, pos: desc.search(re) })).filter((x) => x.pos >= 0).sort((a, b) => a.pos - b.pos).map((x) => x.nombre);
  const tipo = (d.tipoDano || "afectado por agua").toLowerCase().replace(/por agua/, "por humedad").trim();
  const elementos = hallados.length ? mayus(unir(hallados)) : mayus(d.descripcion.trim().replace(/^da(ñ|n)os? (en|de)\s+/i, "").replace(/\s+por agua$/i, "") || "Recinto");
  // Concordancia con un único elemento femenino: «Cubierta rota», «Ventana afectada».
  const femenino = hallados.length === 1 && ["cubierta", "ventana", "puerta"].includes(hallados[0]);
  const tipoConcordado = femenino ? tipo.replace(/^(\p{L}+)o(?=\s|$)/u, "$1a") : tipo;
  const sinTipo = /^afectado|manchado|roto|reparado|fisurado|desprendido|oxidado/.test(tipo) ? tipoConcordado : `con ${tipo}`;
  return `${elementos} ${sinTipo}.`;
}

const AUTOMATICA = /registrado en el acta de inspecci[oó]n\.?$/i;
const normaliza = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Las viñetas automáticas antiguas («N m² con daño de tipo … registrado en el acta») pasan al formato de la tabla de daños; las que escribió una persona o la IA no se tocan. */
export function modernizarEvidencia<T extends { recinto: string; vineta: string }>(evidencias: T[], danos: DanoActa[], hechos?: string | null): T[] {
  return evidencias.map((e) => {
    if (!AUTOMATICA.test(e.vineta.trim())) return e;
    const d = danos.find((x) => normaliza(x.recinto) === normaliza(e.recinto));
    return d ? { ...e, vineta: vinetaDeDano(d, hechos) } : e;
  });
}
