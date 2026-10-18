// Aprende de los ajustes de referencia (carpeta fuente/ajustes finales): qué partida de la hoja Datos corresponde a cada descripción del presupuesto
// y qué partidas suelen ir en cada elemento (cielo, muro, piso…). Escribe lib/conocimiento/semilla.json, que el sistema usa como memoria de partida.
// Uso: npx tsx scripts/aprender-referencias.mts [carpeta]
import ExcelJS from "exceljs";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BAREMO } from "../lib/engine/baremo";
import { elementoDe, normClave, type Elemento } from "../lib/conocimiento/normalizar";

const carpeta = process.argv[2] ?? "fuente/ajustes finales";
const val = (c: ExcelJS.Cell): unknown => {
  const x = c.value as unknown;
  if (x && typeof x === "object" && "result" in x) return (x as { result: unknown }).result;
  if (x && typeof x === "object" && "richText" in x) return (x as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  return x;
};
const num = (c: ExcelJS.Cell) => (typeof val(c) === "number" ? (val(c) as number) : null);
const tokens = (s: string) => new Set(normClave(s).split(" ").filter(Boolean));
const jaccard = (a: Set<string>, b: Set<string>) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return a.size + b.size - i === 0 ? 0 : i / (a.size + b.size - i);
};
const baremoToks = BAREMO.map((b) => ({ b, t: tokens(b.descripcion) }));

/** Partida de la hoja Datos que corresponde a una descripción del presupuesto y al precio al que se ajustó: mismo precio y la descripción más parecida. */
function baremoDe(desc: string, pu: number): number | null {
  const t = tokens(desc);
  const mismos = baremoToks.filter((x) => Math.abs(x.b.pu - pu) < 0.5);
  if (mismos.length === 0) return null;
  const mejor = mismos.map((x) => ({ id: x.b.id, s: jaccard(t, x.t) })).sort((a, b) => b.s - a.s || a.id - b.id)[0];
  return mejor.s >= 0.34 || (mismos.length === 1 && mejor.s >= 0.1) ? mejor.id : null;
}

const partidas: Record<string, Record<number, number>> = {};
const elementos: Record<string, Record<number, number>> = {};
const secciones: Record<string, number> = {};
const estancias: Record<string, number> = {};
let lineas = 0;
let asociadas = 0;

for (const f of readdirSync(carpeta).filter((x) => /\.xlsx$/i.test(x))) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(carpeta, f));
  const ws = wb.getWorksheet("EDIFICIO");
  if (!ws) continue;
  let elementoActual: Elemento = "otros";
  let seccionElemento: string | null = null;
  const vistos = new Set<string>();
  for (let r = 12; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const item = String(val(row.getCell(1)) ?? "");
    const desc = String(val(row.getCell(2)) ?? "").trim();
    if (!/^\d+(\.\d+)+$/.test(item) || !desc) continue;
    const um = String(val(row.getCell(7)) ?? "");
    const puAj = num(row.getCell(9));
    if (!um && puAj === null) {
      // encabezado: estancia (N.0) o elemento (N.k)
      if (item.endsWith(".0")) {
        estancias[normClave(desc)] = (estancias[normClave(desc)] ?? 0) + 1;
        elementoActual = "otros";
      } else {
        elementoActual = elementoDe(desc);
        seccionElemento = `${item}|${elementoActual}`;
        if (elementoActual !== "otros") secciones[elementoActual] = (secciones[elementoActual] ?? 0) + 1;
      }
      continue;
    }
    if (puAj === null || puAj <= 0) continue;
    lineas++;
    const id = baremoDe(desc, puAj);
    if (id === null) continue;
    asociadas++;
    const k = normClave(desc);
    partidas[k] ??= {};
    partidas[k][id] = (partidas[k][id] ?? 0) + 1;
    const el = elementoActual !== "otros" ? elementoActual : elementoDe(desc);
    if (el !== "otros") {
      elementos[el] ??= {};
      // una vez por archivo y estancia-elemento: cuenta secciones, no repeticiones
      const clave = `${f}|${seccionElemento}|${el}|${id}`;
      if (!vistos.has(clave)) {
        vistos.add(clave);
        elementos[el][id] = (elementos[el][id] ?? 0) + 1;
      }
    }
  }
}
const salida = { version: 1, origen: carpeta, lineas, asociadas, partidas, elementos, secciones, estancias };
writeFileSync("lib/conocimiento/semilla.json", JSON.stringify(salida, null, 1));
console.log(`líneas con precio: ${lineas}; asociadas a la hoja Datos: ${asociadas}; descripciones: ${Object.keys(partidas).length}; elementos:`, Object.fromEntries(Object.entries(elementos).map(([k, v]) => [k, Object.keys(v).length])), "secciones:", secciones);
