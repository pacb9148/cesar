import type { ActaInspeccion, DanoActa } from "../extraccion/acta";

type ConExtras = ActaInspeccion & { tipoInmueble?: string | null; causa?: string | null };

const en = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const m2 = (n: number) => n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unir = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/**
 * Párrafo con la descripción del inmueble a partir de los puntos de la inspección que lo describen (tipo, pisos, dormitorios, baños, antigüedad y
 * características de la construcción). Solo dice lo que consta: lo que falta no se menciona. Devuelve «» si no hay nada que decir.
 */
export function parrafoInmueble(a: ConExtras): string {
  // «Casa» se redacta siempre como «Vivienda»; otros tipos (departamento, local…) se conservan.
  const bruto = (a.tipoInmueble ?? "").trim().toLowerCase();
  const tipo = mayus(!bruto || bruto === "casa" ? "vivienda" : bruto);
  const base = `${tipo}${a.pisos ? ` de ${en(a.pisos, "piso", "pisos")}` : ""}`;
  const superficie = a.superficieM2 ? `con una superficie construida de ${m2(a.superficieM2)} m²` : "";
  const recintos = [a.dormitorios ? en(a.dormitorios, "dormitorio", "dormitorios") : "", a.banos ? en(a.banos, "baño", "baños") : ""].filter(Boolean);
  const consta = recintos.length ? `que consta de ${unir(recintos)}` : "";
  const antiguedad = a.antiguedad ? `tiene una antigüedad de ${en(a.antiguedad, "año", "años")}` : "";
  // «Vivienda de 2 pisos con una superficie construida de 90 m², que consta de 3 dormitorios y 2 baños, y tiene una antigüedad de 7 años.»
  const partes = [superficie ? `${base} ${superficie}` : base, consta].filter(Boolean);
  const primera = antiguedad ? `${partes.join(", ")}, y ${antiguedad}` : partes.join(", ");
  const construccion = [
    a.sistemaEstructural ? `estructura ${a.sistemaEstructural.replace(/^estructura( de)?\s*/i, "de ").replace(/^de de /, "de ").trim().toLowerCase()}` : "",
    a.estructuraTechumbre ? `techumbre de ${a.estructuraTechumbre.replace(/^(estructura|techumbre)( de)?\s*/i, "").trim().toLowerCase()}` : "",
    a.cubierta ? `cubierta de ${a.cubierta.replace(/^cubierta( de)?\s*/i, "").trim().toLowerCase()}` : "",
    a.pavimentos ? `pavimentos de ${a.pavimentos.replace(/^pavimentos?( de)?\s*/i, "").trim().toLowerCase()}` : "",
  ].filter(Boolean);
  if (!a.pisos && !a.dormitorios && !a.banos && !a.antiguedad && !a.superficieM2 && construccion.length === 0 && !a.tipoInmueble) return "";
  return `${primera}.${construccion.length ? ` Su construcción es de ${construccion[0]}${construccion.length > 1 ? `, con ${unir(construccion.slice(1))}` : ""}.` : ""}`;
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
 * Viñeta de la evidencia de un recinto a partir de la tabla «Daños y perjuicios»: «Muro afectado por humedad.», «Cielo y muro afectado por humedad.».
 * Los elementos salen en el orden en que los nombra la descripción; el tipo de daño «por agua» se dice «por humedad».
 */
export function vinetaDeDano(d: Pick<DanoActa, "descripcion" | "tipoDano">): string {
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
export function modernizarEvidencia<T extends { recinto: string; vineta: string }>(evidencias: T[], danos: DanoActa[]): T[] {
  return evidencias.map((e) => {
    if (!AUTOMATICA.test(e.vineta.trim())) return e;
    const d = danos.find((x) => normaliza(x.recinto) === normaliza(e.recinto));
    return d ? { ...e, vineta: vinetaDeDano(d) } : e;
  });
}
