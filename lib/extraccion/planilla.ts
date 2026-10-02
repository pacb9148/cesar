import ExcelJS from "exceljs";
import type { DecisionLinea, LineaAdicional, LineaReclamacion, Reclamacion, Unidad } from "../domain/tipos";
import { LETRAS_OBS } from "../domain/constantes";

export type PlanillaLeida = {
  reclamacion: Reclamacion;
  /** Decisiones tal como figuran en la planilla (verdad de referencia en los tests). */
  decisiones: DecisionLinea[];
  adicionales: LineaAdicional[];
  valorUF: number | null;
  ufCalculadoReclamacion: number | null;
  ufCalculadoAjuste: number | null;
};

const val = (c: ExcelJS.Cell): unknown => {
  const v = c.value;
  if (v && typeof v === "object" && "result" in v) return (v as { result: unknown }).result;
  if (v && typeof v === "object" && "richText" in v)
    return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  return v;
};
const num = (c: ExcelJS.Cell): number | null => {
  const v = val(c);
  return typeof v === "number" ? v : null;
};
const txt = (c: ExcelJS.Cell): string => {
  const v = val(c);
  return v == null ? "" : String(v).trim();
};

const UM: Record<string, Unidad> = { m2: "m2", ml: "ml", gl: "gl", un: "un", m3: "m3", kg: "kg" };
const um = (s: string): Unidad => UM[s.toLowerCase().replace("²", "2")] ?? "gl";

/**
 * Lee la hoja EDIFICIO de una planilla emitida. Sirve para: (1) pruebas contra la verdad
 * de referencia y (2) importar la reclamación cuando el contratista la entrega en el mismo formato.
 */
export async function leerPlanilla(ruta: string | Buffer): Promise<PlanillaLeida> {
  const wb = new ExcelJS.Workbook();
  if (typeof ruta === "string") await wb.xlsx.readFile(ruta);
  else await wb.xlsx.load(ruta as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("EDIFICIO");
  if (!ws) throw new Error("La planilla no tiene hoja EDIFICIO");

  // Algunas planillas (pérdida determinada) traen una sola columna de valores.
  const dosColumnas = txt(ws.getCell("C10")).toLowerCase().startsWith("reclam");

  const secciones: { numero: string; titulo: string }[] = [];
  const lineas: LineaReclamacion[] = [];
  const decisiones: DecisionLinea[] = [];
  const adicionales: LineaAdicional[] = [];
  let seccionActual = "";
  let totalDirectoDeclarado: number | null = null;
  let ggPct = 0;
  let utilidadPct = 0;
  let ivaPct = 0.19;
  let valorUF: number | null = null;
  let ufRec: number | null = null;
  let ufAj: number | null = null;

  for (let r = 11; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const a = txt(row.getCell(1));
    const b = txt(row.getCell(2));
    if (/^\d+\.\d+$/.test(a) && b) {
      const esSeccion = a.endsWith(".0");
      if (esSeccion) {
        seccionActual = b;
        secciones.push({ numero: a, titulo: b });
        continue;
      }
      const cant = num(row.getCell(4));
      const pu = num(row.getCell(5));
      if (dosColumnas) {
        if (cant == null || pu == null) {
          const hc = num(row.getCell(8));
          const hp = num(row.getCell(9));
          if (hc != null && hp != null)
            adicionales.push({
              seccion: seccionActual,
              descripcion: b,
              um: um(txt(row.getCell(7))),
              cantidad: hc,
              pu: hp,
              pu_origen: "mercado:planilla de referencia",
              obs: [],
              justificacion: "Partida propia del perito",
            });
          continue;
        }
        lineas.push({ item: a, recinto: seccionActual, descripcion: b, um: um(txt(row.getCell(3))), cantidad: cant, pu });
        const hCant = num(row.getCell(8));
        const hPu = num(row.getCell(9));
        const obs = [txt(row.getCell(11)), txt(row.getCell(12))].filter((x) => (LETRAS_OBS as readonly string[]).includes(x));
        decisiones.push({
          item: a,
          accion: "ajustar",
          um: um(txt(row.getCell(7)) || txt(row.getCell(3))),
          cantidad: hCant,
          pu: hPu,
          pu_origen: "reclamacion",
          obs: obs as DecisionLinea["obs"],
          justificacion: "Planilla de referencia",
          sublineas: [],
        });
      } else {
        // Una sola columna: es el valor determinado por el perito (no hay reclamación).
        if (cant == null || pu == null) continue;
        lineas.push({ item: a, recinto: seccionActual, descripcion: b, um: um(txt(row.getCell(3))), cantidad: cant, pu });
      }
      continue;
    }
    const etiqueta = b.toLowerCase();
    if (etiqueta.startsWith("total directo")) totalDirectoDeclarado = num(row.getCell(6));
    else if (etiqueta.startsWith("gastos generales")) {
      ggPct = num(row.getCell(3)) ?? ggPct;
    } else if (etiqueta.startsWith("utilidades")) {
      utilidadPct = num(row.getCell(3)) ?? utilidadPct;
    } else if (etiqueta.startsWith("iva")) ivaPct = num(row.getCell(3)) ?? ivaPct;
    else if (etiqueta.startsWith("equivalente en moneda")) {
      ufRec = num(row.getCell(6));
      ufAj = dosColumnas ? num(row.getCell(10)) : null;
    } else if (etiqueta.startsWith("indicador para fdp")) valorUF = num(row.getCell(3));
  }

  return {
    reclamacion: { secciones, lineas, totalDirectoDeclarado, ggPct, utilidadPct, ivaPct },
    decisiones,
    adicionales,
    valorUF,
    ufCalculadoReclamacion: ufRec,
    ufCalculadoAjuste: ufAj,
  };
}
