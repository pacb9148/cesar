import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { aplicarCeldas, cargarLibro, libroAVista } from "../lib/docs/vista-xlsx";

async function libro(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("EDIFICIO");
  ws.getCell("B2").value = "Una descripción bastante larga de una partida";
  ws.getCell("C2").value = 5;
  ws.getColumn(2).width = 10;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("formato de la planilla ajustado por el usuario", () => {
  it("el ancho de columna, el alto de fila y el ajuste de texto pasan al archivo y vuelven a la vista", async () => {
    const { buffer } = await aplicarCeldas(await libro(), [], {
      columnas: [{ hoja: "EDIFICIO", c: 2, ancho: 350 }],
      filas: [{ hoja: "EDIFICIO", r: 2, alto: 40 }],
      ajusteTexto: [{ hoja: "EDIFICIO", activo: true }],
    });
    const ws = (await cargarLibro(buffer)).getWorksheet("EDIFICIO")!;
    expect(ws.getColumn(2).width).toBeCloseTo(50, 1); // 350 px ÷ 7
    expect(ws.getRow(2).height).toBeCloseTo(30, 1); // 40 px × 0,75
    expect(ws.getCell("B2").alignment?.wrapText).toBe(true);
    const h = libroAVista(await cargarLibro(buffer))[0];
    expect(h.anchos[1]).toBe(350);
    expect(h.altos[1]).toBe(40);
    expect(h.ajusteTexto).toBe(true);
  });
  it("un alto 0 devuelve la fila al alto automático y desactivar el ajuste lo quita", async () => {
    const a = await aplicarCeldas(await libro(), [], { filas: [{ hoja: "EDIFICIO", r: 2, alto: 40 }], ajusteTexto: [{ hoja: "EDIFICIO", activo: true }] });
    const b = await aplicarCeldas(a.buffer, [], { filas: [{ hoja: "EDIFICIO", r: 2, alto: 0 }], ajusteTexto: [{ hoja: "EDIFICIO", activo: false }] });
    const h = libroAVista(await cargarLibro(b.buffer))[0];
    expect(h.altos[1]).toBe(0);
    expect(h.ajusteTexto).toBe(false);
  });
  it("rechaza una hoja o una columna que no existen", async () => {
    await expect(aplicarCeldas(await libro(), [], { columnas: [{ hoja: "Otra", c: 1, ancho: 100 }] })).rejects.toThrow(/no existe/);
    await expect(aplicarCeldas(await libro(), [], { columnas: [{ hoja: "EDIFICIO", c: 99, ancho: 100 }] })).rejects.toThrow(/fuera de rango/);
  });
});
