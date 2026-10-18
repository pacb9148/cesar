import type { LineaAdicional } from "../domain/tipos";
import type { ActaInspeccion, DanoActa } from "../extraccion/acta";
import { candidatos, porId } from "../engine/baremo";
import { cubicar } from "../engine/cubicacion";
import { coincideEstancia } from "../fotos/orden";
import { extrasDeElemento, type Aprendido } from "../conocimiento";

type Elem = "cielo" | "muro" | "cubierta" | "piso" | "ventana" | "puerta";
type Conjunto = { etiqueta: string; elemento: string; ids: number[]; um: "m2" | "un" };

/**
 * Partidas del baremo (hoja Datos) que reparan cada elemento afectado. Cielo y muros: preparación de superficie, empaste y lijado, y pintura.
 * Cubierta: retiro e instalación de cubierta. Piso: preparación y reparación. Ventanas y puertas: reparación de fisuras y sellos (por unidad).
 */
const CONJUNTOS: Record<Elem, Conjunto> = {
  cielo: { etiqueta: "cielo", elemento: "Cielo", ids: [2, 3, 37], um: "m2" },
  muro: { etiqueta: "muros", elemento: "Muro", ids: [6, 7, 46], um: "m2" },
  cubierta: { etiqueta: "cubierta", elemento: "Cubierta", ids: [266, 267], um: "m2" },
  piso: { etiqueta: "piso", elemento: "Piso", ids: [247, 283], um: "m2" },
  ventana: { etiqueta: "ventanas", elemento: "Ventana", ids: [273, 184], um: "un" },
  puerta: { etiqueta: "puertas", elemento: "Puerta", ids: [181, 182], um: "un" },
};
const CON_AREA: Elem[] = ["cielo", "muro", "cubierta", "piso"];

const r2 = (n: number) => Math.round(n * 100) / 100;

const PATRONES: [Elem, RegExp][] = [
  ["cielo", /cielo/],
  ["muro", /pared|muro|tabique/],
  ["cubierta", /cubierta|techumbre|techo|zinc|plancha|teja|hojalater|caballete|alero/],
  ["piso", /piso|pavimento|radier|alfombra|flotante|cer[aá]mic/],
  ["ventana", /ventana|vidrio/],
  ["puerta", /puerta/],
];

/** Elementos afectados que nombra el recinto o la descripción del daño, en el orden en que aparecen. */
function elementosDe(texto: string): Elem[] {
  const d = texto.toLowerCase();
  return PATRONES.map(([e, re]) => [e, d.search(re)] as const)
    .filter(([, pos]) => pos >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([e]) => e);
}

const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * El acta a veces trae la descripción del daño cortada y sin nombrar el elemento («Escurrimiento de agua…»). Entonces se busca en los hechos del
 * siniestro el elemento nombrado justo antes del recinto («humedad en el cielo del quincho»); el más cercano al nombre es el que corresponde.
 */
function elementosDeHechos(hechos: string | null | undefined, recinto: string): Elem[] {
  const h = sinTildes(hechos ?? "");
  const nombre = sinTildes(recinto).trim();
  if (!h || !nombre) return [];
  const encontrados = new Set<Elem>();
  for (let desde = h.indexOf(nombre); desde >= 0; desde = h.indexOf(nombre, desde + 1)) {
    const previo = elementosDe(h.slice(Math.max(0, desde - 40), desde));
    if (previo.length) encontrados.add(previo[previo.length - 1]);
  }
  return [...encontrados];
}

/** Daño por agua sin elemento nombrado ni en el acta ni en los hechos: lo habitual es que afecte cielo y muros del recinto. */
const POR_DEFECTO: Elem[] = ["cielo", "muro"];
const DANO_POR_AGUA = /humedad|filtraci|escurr|gotera|mancha|hongo|inflad|pandeo|agua|lluvia|union abierta/;

/** Variantes de partida según el material que nombra el daño (teja en vez de zinc, piso flotante o cerámico). */
function idsDe(e: Elem, texto: string): number[] {
  const d = texto.toLowerCase();
  if (e === "cubierta") return [.../teja/.test(d) ? [89, 90] : CONJUNTOS.cubierta.ids, ...(/hojalater|sello/.test(d) ? [270] : [])];
  if (e === "piso") return /flotante/.test(d) ? [261, 262] : /cer[aá]mic/.test(d) ? [81, 248] : CONJUNTOS.piso.ids;
  return CONJUNTOS[e].ids;
}

/** Partidas extra por elemento que la memoria sugiere (se calcula en el servidor y viaja a la pantalla como datos simples). */
export type ExtrasMemoria = Record<string, { id: number; um: string }[]>;
export const extrasDeMemoria = (a: Aprendido): ExtrasMemoria =>
  Object.fromEntries((Object.keys(CONJUNTOS) as Elem[]).map((e) => [e, extrasDeElemento(a, e, CONJUNTOS[e].ids)]));

export type PartidasDeEvidencia = { partidas: LineaAdicional[]; sinPartida: string[] };

const partida = (seccion: string, elemento: string, b: { id: number; descripcion: string; pu: number }, um: LineaAdicional["um"], cantidad: number, justificacion: string): LineaAdicional => ({
  seccion,
  elemento,
  descripcion: b.descripcion,
  um,
  cantidad,
  pu: b.pu,
  pu_origen: `baremo:${b.id}`,
  obs: um === "m2" ? ["B", "C"] : ["B"],
  justificacion,
});

/**
 * Convierte la evidencia de la inspección (tabla «Daños y perjuicios») en partidas de liquidación a precio de baremo: TODAS las estancias que menciona,
 * cada una con las partidas imputables a sus daños (cielo, muros, cubierta, piso, ventanas, puertas) y la cantidad de la medición del acta (si el daño toca
 * varios elementos, se reparte según la cubicación del recinto). Un daño que no encaja en ninguno busca la partida más parecida de la hoja Datos; solo si
 * tampoco hay ninguna queda en `sinPartida`.
 */
export function partidasDeEvidencia(acta: Pick<ActaInspeccion, "danos"> & { hechos?: string | null }, opciones: { omitirEstancias?: string[]; aprendido?: Aprendido; extras?: ExtrasMemoria } = {}): PartidasDeEvidencia {
  const partidas: LineaAdicional[] = [];
  const sinPartida: string[] = [];
  for (const d of acta.danos as DanoActa[]) {
    // Con presupuesto solo se agregan las estancias de la evidencia que el presupuesto no trae.
    if ((opciones.omitirEstancias ?? []).some((s) => coincideEstancia(s, d.recinto))) continue;
    const seccion = d.recinto.trim().toUpperCase();
    const texto = `${d.recinto} ${d.descripcion}`;
    let elementos = elementosDe(texto);
    if (elementos.length === 0) elementos = elementosDeHechos(acta.hechos, d.recinto);
    if (elementos.length === 0 && DANO_POR_AGUA.test(sinTildes(texto))) elementos = POR_DEFECTO;
    if (elementos.length === 0) {
      const b = candidatos(`${d.tipoDano} ${d.descripcion}`, 1)[0] ?? candidatos(d.descripcion, 1)[0];
      if (!b) {
        sinPartida.push(`${d.recinto}: «${d.descripcion}» no tiene partida automática; agrégala a mano.`);
        continue;
      }
      const um = (["m2", "ml", "gl", "un", "m3", "kg"] as const).find((u) => u === d.um) ?? "m2";
      partidas.push(partida(seccion, "Otros", b, um, Math.max(1, d.cantidad), `Daño descrito en el acta («${d.descripcion}», ${d.cantidad} ${d.um}), a precio de baremo a todo costo.`));
      continue;
    }
    const cub = cubicar({ alto: d.alto, largo: d.largo, ancho: d.ancho });
    const peso = (e: Elem) => (e === "muro" ? cub.muroNeto : e === "piso" ? cub.piso : cub.cielo);
    const conArea = elementos.filter((e) => CON_AREA.includes(e));
    const total = conArea.reduce((s, e) => s + peso(e), 0);
    for (const e of elementos) {
      const c = CONJUNTOS[e];
      const unitario = c.um === "un";
      const cantidad = unitario ? 1 : Math.max(1, r2(conArea.length === 1 ? d.cantidad : total > 0 ? (d.cantidad * peso(e)) / total : d.cantidad / conArea.length));
      // Además de las de base, las partidas que el usuario suele agregar en este elemento (memoria del sistema).
      const extras = opciones.extras?.[e] ?? (opciones.aprendido ? extrasDeElemento(opciones.aprendido, e, c.ids) : []);
      const ids = [...idsDe(e, texto), ...extras.map((x) => x.id)];
      for (const id of ids) {
        const b = porId(id);
        if (!b) continue;
        const um = (extras.find((x) => x.id === id)?.um ?? (id === 270 ? "gl" : c.um)) as LineaAdicional["um"];
        partidas.push(partida(seccion, c.elemento, b, um, um === "m2" ? cantidad : 1, `Reparación del daño observado en ${c.etiqueta} del recinto (${d.cantidad} m² según acta), a precio de baremo a todo costo.`));
      }
    }
  }
  return { partidas, sinPartida };
}
