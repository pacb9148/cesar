// Convierte el borrador del caso 4 (plantilla real de Beckett) en una plantilla genérica con marcadores.
// Se ejecuta una vez; el resultado queda en plantillas/informe.docx.
import PizZip from "pizzip";
import { readFileSync, writeFileSync, globSync } from "node:fs";
import { parse, serializar, reemplazarGlobal, porTag, textoDe, reemplazarEnParrafo } from "../lib/docs/docx-xml";

const [origen] = globSync("fuente/1984853*/TEXTO/1984853 Informe borrador v1.docx");
const zip = new PizZip(readFileSync(origen));

const REEMPLAZOS: [string, string][] = [
  ["172363/ 2026", "{{liquidacion}}/{{anio}}"],
  ["172363", "{{liquidacion}}"],
  ["1984853", "{{siniestro}}"],
  ["Francisco Andres Olea Yeomans", "{{asegurado}}"],
  ["Trumao 2289, Osorno, Región de Los Lagos", "{{ubicacion}}"],
  ["17.762.449-7", "{{rut_asegurado}}"],
  ["20580184", "{{poliza}}"],
  ["ítem 5", "ítem {{item}}"],
  ["2.023,00", "{{suma_asegurada}}"],
  ["18/08/2026", "{{f_inspeccion}}"],
  ["16/07/2026", "{{f_ocurrencia}}"],
  ["21/08/2026", "{{f_emision}}"],
  ["40.860,60", "{{valor_uf}}"],
  ["01/10/2024", "{{vig_desde}}"],
  ["30/09/2026", "{{vig_hasta}}"],
];

const partes = Object.keys(zip.files).filter((n) => /^word\/(document|header\d|footer\d)\.xml$/.test(n));
for (const n of partes) {
  const doc = parse(zip.file(n)!.asText());
  for (const [de, a] of REEMPLAZOS) reemplazarGlobal(doc.documentElement, de, a);
  zip.file(n, serializar(doc));
}

// Control: ningún dato del caso 4 debe sobrevivir en la plantilla.
const prohibidos = ["Olea", "Trumao", "Osorno", "1984853", "172363", "17.762", "2.023", "Los Lagos"];
for (const n of partes) {
  const t = porTag(parse(zip.file(n)!.asText()), "p").map(textoDe).join("\n");
  for (const x of prohibidos) if (t.includes(x)) throw new Error(`Residuo "${x}" en ${n}`);
}
void reemplazarEnParrafo;
writeFileSync("plantillas/informe.docx", zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("plantilla generada; partes procesadas:", partes.length);
