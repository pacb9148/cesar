import { describe, it, expect } from "vitest";
import { globSync } from "node:fs";
import ExcelJS from "exceljs";
import { leerPlanilla } from "../lib/extraccion/planilla";
import { generarExcel } from "../lib/docs/excel";
import { datosCasoSchema } from "../lib/domain/tipos";
import { armarFilas } from "../lib/engine/filas";
import { auditarAjuste, reparosDeOrigenPrecio } from "../lib/engine/auditoria";
import { verificarPresupuestoGenerado } from "../lib/docs/verificar-presupuesto";
import { aplicarCeldas, cargarLibro, libroAVista } from "../lib/docs/vista-xlsx";
import { BAREMO } from "../lib/engine/baremo";

const caso = datosCasoSchema.parse({
  siniestro: "1981023", liquidacion: "170448", aseguradora: "HDI Seguros S.A",
  asegurado: { nombre: "Juan Antonio Riquelme Muñoz", rut: "17.897.486-6", direccion: "Huérfanos 1751, Concepción" },
  beneficiario: { nombre: "Banco del Estado de Chile S.A.", rut: "97.030.000-7", direccion: "Santiago" },
  poliza: { tipo: "Incendio", numero: "1", item: "4", vigenciaDesde: "01/10/2024", vigenciaHasta: "30/09/2026", materia: "Edificio", sumaAseguradaUF: 1294, deducibleUF: 0 },
  ubicacion: "Concepción", comuna: "Concepción", region: "Biobío",
  fechas: { inspeccion: "07/08/2026", asignacion: "29/07/2026", denuncia: "29/07/2026", ocurrencia: "2026-07-16", emision: "24/08/2026", informadoPartes: null },
  denunciaTexto: null, modo: "reclamacion",
});

async function generado() {
  const orig = await leerPlanilla(globSync("fuente/1981023*/1981023 Ajuste v1.xlsx")[0]);
  const entrada = { caso, reclamacion: orig.reclamacion, decisiones: orig.decisiones, adicionales: orig.adicionales, valorUF: orig.valorUF!, recintos: [], siniestrosAnteriores: [] };
  return { orig, entrada, buf: await generarExcel(entrada) };
}

describe("integridad del presupuesto original", () => {
  it("el Excel generado conserva intacta la Reclamación de cada partida y el ajuste solo va en Valor ajustado", async () => {
    const { entrada, buf } = await generado();
    const filas = armarFilas(entrada);
    expect(await verificarPresupuestoGenerado(buf, filas, entrada.reclamacion)).toEqual([]);
    expect(auditarAjuste(filas, entrada.reclamacion).cumple).toBe(true);
  });

  it("detecta una Reclamación alterada en el Excel y una partida que falta", async () => {
    const { entrada, buf } = await generado();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet("EDIFICIO")!;
    const l = entrada.reclamacion.lineas[0];
    let fila = 0;
    ws.eachRow((row, r) => { if (String(row.getCell(1).value ?? "") === l.item && !fila) fila = r; });
    ws.getCell(fila, 5).value = l.pu + 1000;
    const alterado = Buffer.from(await wb.xlsx.writeBuffer());
    const p = await verificarPresupuestoGenerado(alterado, armarFilas(entrada), entrada.reclamacion);
    expect(p.some((x) => x.startsWith(`${l.item}:`))).toBe(true);

    const sinUna = { ...entrada.reclamacion, lineas: entrada.reclamacion.lineas.slice(1) };
    const filasSinUna = armarFilas({ ...entrada, reclamacion: sinUna });
    const a = auditarAjuste(filasSinUna, entrada.reclamacion);
    expect(a.verificaciones.find((v) => v.codigo === "ERR_COVERAGE")!.ok).toBe(false);
    expect(a.verificaciones.find((v) => v.codigo === "ERR_TOTAL")!.ok).toBe(false);
  });

  it("las celdas de Reclamación (C–F) están protegidas en la vista y rechazan la edición; las de Valor ajustado sí se editan", async () => {
    const { entrada, buf } = await generado();
    const vista = libroAVista(await cargarLibro(buf)).find((h) => h.nombre === "EDIFICIO")!;
    const primera = vista.celdas.find((c) => c.c === 4 && c.r > 11 && c.txt !== "")!;
    expect(primera.prot).toBe(true);
    expect(vista.celdas.find((c) => c.r === primera.r && c.c === 8)?.prot).toBeUndefined();
    await expect(aplicarCeldas(buf, [{ hoja: "EDIFICIO", r: primera.r, c: 4, valor: "99" }])).rejects.toThrow(/Reclamación del contratista/);
    const ok = await aplicarCeldas(buf, [{ hoja: "EDIFICIO", r: primera.r, c: 8, valor: "2" }]);
    expect(ok.buffer.length).toBeGreaterThan(0);
    expect(entrada.reclamacion.lineas.length).toBeGreaterThan(0);
  });

  it("cada precio rastreado al baremo debe coincidir con la hoja Datos; el de mercado se reporta", () => {
    const b = BAREMO[0];
    const dec = (pu: number, origen: string) => ({ item: "1.1", accion: "ajustar" as const, um: "m2" as const, cantidad: 1, pu, pu_origen: origen, obs: ["A" as const], justificacion: "x", sublineas: [] });
    expect(reparosDeOrigenPrecio([dec(b.pu, `baremo:${b.id}`)], [])).toEqual([]);
    expect(reparosDeOrigenPrecio([dec(b.pu + 500, `baremo:${b.id}`)], [])).toHaveLength(1);
    expect(reparosDeOrigenPrecio([dec(1000, "baremo:999999")], [])).toHaveLength(1);
    expect(reparosDeOrigenPrecio([dec(1000, "mercado:proveedor X")], [])).toHaveLength(1);
    expect(reparosDeOrigenPrecio([dec(1000, "reclamacion")], [])).toEqual([]);
  });
});

describe("baremo.json y la hoja Datos de la plantilla", () => {
  it("contienen exactamente las mismas partidas con precio (descripción y precio)", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile("plantillas/ajuste-base.xlsx");
    const hoja: string[] = [];
    wb.getWorksheet("Datos")!.eachRow((r) => {
      const d = r.getCell(2).value;
      const p = r.getCell(3).value;
      if (d && typeof p === "number" && p > 0) hoja.push(`${String(d).trim()}|${p}`);
    });
    const baremo = BAREMO.map((b) => `${b.descripcion.trim()}|${b.pu}`);
    expect(baremo.sort()).toEqual(hoja.sort());
  });
});
