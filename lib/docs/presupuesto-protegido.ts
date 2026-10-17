import type ExcelJS from "exceljs";

/** Hoja del presupuesto del contratista y fila donde empieza el cuadro (encabezados «Reclamación» / «Valor ajustado»). */
export const HOJA_PRESUPUESTO = "EDIFICIO";
export const FILA_CUADRO = 10;
/** Columnas C–F: unidad, cantidad, precio unitario y total reclamados (la parte azul). */
const COL_RECLAMACION = [3, 4, 5, 6];

const vacia = (v: ExcelJS.CellValue): boolean => v == null || v === "";

/**
 * La parte de Reclamación del presupuesto no se toca nunca: ni el agente ni el usuario. Los ajustes van solo en «Valor ajustado»
 * (columnas G–J y OBS). El ítem y la descripción de una partida reclamada tampoco se editan; los de una partida propia del perito sí.
 */
export function celdaProtegida(ws: ExcelJS.Worksheet, r: number, c: number): boolean {
  if (ws.name !== HOJA_PRESUPUESTO || r < FILA_CUADRO) return false;
  // En pérdida determinada no hay columna de Reclamación: las columnas C–F ya son el valor ajustado.
  if (String(ws.getCell(FILA_CUADRO, 3).value ?? "").trim() !== "Reclamación") return false;
  if (COL_RECLAMACION.includes(c)) return true;
  return c <= 2 && !vacia(ws.getCell(r, 3).value);
}
