// Genera lib/baremo/baremo.json desde la hoja "Datos" (idéntica en los 7 libros de referencia).
import ExcelJS from "exceljs";
import { writeFileSync, globSync } from "node:fs";


const [archivo] = globSync("fuente/1981023*/1981023 Ajuste v1.xlsx");
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(archivo);
const ws = wb.getWorksheet("Datos");
if (!ws) throw new Error("Sin hoja Datos");
const items: { id: number; descripcion: string; pu: number }[] = [];
ws.eachRow((row, n) => {
  if (n < 3) return;
  const d = row.getCell(2).value;
  const p = row.getCell(3).value;
  if (typeof d === "string" && d.trim() && typeof p === "number" && p > 0) {
    items.push({ id: items.length + 1, descripcion: d.trim(), pu: p });
  }
});
writeFileSync("lib/baremo/baremo.json", JSON.stringify(items, null, 1));
console.log("partidas de baremo:", items.length);
