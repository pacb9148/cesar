import ExcelJS from "exceljs";
import type { Reclamacion } from "../domain/tipos";
import type { FilaCuadro } from "../engine/filas";
import { HOJA_PRESUPUESTO, FILA_CUADRO } from "./presupuesto-protegido";

const num = (v: ExcelJS.CellValue): number | null => {
  const x = v && typeof v === "object" && "result" in v ? v.result : v;
  return typeof x === "number" ? x : null;
};
const txt = (v: ExcelJS.CellValue): string => {
  const x = v && typeof v === "object" && "result" in v ? v.result : v;
  return x == null ? "" : String(x).trim();
};
const cerca = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.005;

/**
 * Relee el Excel ya generado y lo contrasta con el presupuesto original: la parte de Reclamación (columnas C–F) debe ser idéntica
 * a lo que reclamó el contratista, cada partida original debe estar, y el ajuste debe estar solo en «Valor ajustado» (G–J).
 * Devuelve la lista de diferencias; vacía si el documento es fiel.
 */
export async function verificarPresupuestoGenerado(xlsx: Buffer, filas: FilaCuadro[], reclamacion: Reclamacion): Promise<string[]> {
  if (reclamacion.lineas.length === 0) return [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as never);
  const ws = wb.getWorksheet(HOJA_PRESUPUESTO);
  if (!ws) return [`El Excel no tiene la hoja «${HOJA_PRESUPUESTO}».`];
  const filaDe = new Map<string, number>();
  for (let r = FILA_CUADRO + 2; r <= ws.rowCount; r++) {
    const item = txt(ws.getCell(r, 1).value);
    if (item && !filaDe.has(item)) filaDe.set(item, r);
  }
  const problemas: string[] = [];
  for (const l of reclamacion.lineas) {
    const r = filaDe.get(l.item);
    if (!r) {
      problemas.push(`${l.item}: la partida reclamada no está en el Excel.`);
      continue;
    }
    if (txt(ws.getCell(r, 3).value) !== l.um || !cerca(num(ws.getCell(r, 4).value), l.cantidad) || !cerca(num(ws.getCell(r, 5).value), l.pu))
      problemas.push(`${l.item}: la Reclamación del Excel difiere de la original (${l.um} ${l.cantidad} × ${l.pu}).`);
  }
  for (const f of filas) {
    if (f.tipo !== "linea") continue;
    const r = filaDe.get(f.item);
    if (!r) continue;
    if (!f.rec && [3, 4, 5, 6].some((c) => txt(ws.getCell(r, c).value) !== "")) problemas.push(`${f.item}: partida propia del perito con datos en la columna de Reclamación.`);
    if (f.aj && (txt(ws.getCell(r, 7).value) !== f.aj.um || !cerca(num(ws.getCell(r, 8).value), f.aj.cantidad) || !cerca(num(ws.getCell(r, 9).value), f.aj.pu)))
      problemas.push(`${f.item}: el Valor ajustado del Excel no coincide con la decisión del ajuste.`);
  }
  return problemas;
}
