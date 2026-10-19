import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { generarExcel } from "../lib/docs/excel";
import { cuadroTablaXml } from "../lib/docs/cuadro";
import { datosCasoSchema } from "../lib/domain/tipos";
import { salidaBase } from "../lib/caso/ajuste-base";
import { parsearActa } from "../lib/extraccion/acta";
import { textoPdf } from "../lib/extraccion/pdf";

const ACTA = "fuente/1984853-172363-Francisco Andres Olea Yeomans-Banco Estado/TEXTO/INSP.-13124.pdf";
const caso = (modo: "reclamacion" | "perdida_determinada") =>
  datosCasoSchema.parse({
    siniestro: "1984853", liquidacion: "172363", aseguradora: "HDI Seguros S.A",
    asegurado: { nombre: "Francisco Olea", rut: "1-9", direccion: "Trumao 2289" },
    beneficiario: { nombre: "Banco", rut: "97", direccion: "Santiago" },
    poliza: { tipo: "Incendio", numero: "1", item: "4", vigenciaDesde: "01/10/2024", vigenciaHasta: "30/09/2026", materia: "Edificio", sumaAseguradaUF: 2023, deducibleUF: 0 },
    ubicacion: "Osorno", comuna: "Osorno", region: "Los Lagos",
    fechas: { inspeccion: "07/08/2026", asignacion: "29/07/2026", denuncia: "29/07/2026", ocurrencia: "2026-07-16", emision: "24/08/2026", informadoPartes: null },
    denunciaTexto: null, modo,
  });
const recl = { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 };

describe("«Partida determinada» (sin presupuesto)", () => {
  it("el Excel lleva «Partida determinada» en lugar de Reclamación, sin valor ajustado, con OBS y leyenda, con estancia → elemento → partidas", async () => {
    const a = parsearActa(await textoPdf(readFileSync(ACTA)));
    const s = salidaBase(a, { conPartidas: true });
    const buf = await generarExcel({ caso: caso("perdida_determinada"), reclamacion: recl, decisiones: [], adicionales: s.lineas_adicionales, valorUF: 40844.79, recintos: [], siniestrosAnteriores: [] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet("EDIFICIO")!;
    expect(String(ws.getCell("C10").value)).toBe("Partida determinada");
    for (const c of ["G10", "H10", "G11"]) expect(ws.getCell(c).value ?? null).toBeNull();
    expect(String(ws.getCell("K10").value)).toBe("OBS");
    expect(ws.getColumn(7).hidden).toBe(true);
    const items: string[] = [];
    const textos: string[] = [];
    ws.eachRow((r) => {
      items.push(String(r.getCell(1).value ?? ""));
      textos.push(String(r.getCell(2).value ?? ""));
    });
    expect(items).toContain("1.0");
    expect(items).toContain("1.1");
    expect(items).toContain("1.1.1");
    expect(textos).toContain("Observaciones");
  });
  it("con presupuesto la leyenda lista solo las observaciones usadas y una partida sin cambios queda sin letra", async () => {
    const a = parsearActa(await textoPdf(readFileSync(ACTA)));
    const s = salidaBase(a, { reclamacion: { ...recl, secciones: [{ numero: "1.0", titulo: "LIVING" }] } });
    const buf = await generarExcel({ caso: caso("reclamacion"), reclamacion: { ...recl, secciones: [{ numero: "1.0", titulo: "LIVING" }], lineas: [{ item: "1.1", recinto: "LIVING", descripcion: "Pintura", um: "m2", cantidad: 10, pu: 5000 }] }, decisiones: [], adicionales: s.lineas_adicionales, valorUF: 40844.79, recintos: [], siniestrosAnteriores: [] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet("EDIFICIO")!;
    const filaPintura = [...Array(40).keys()].map((i) => i + 12).find((r) => String(ws.getCell(r, 2).value) === "Pintura")!;
    expect(ws.getCell(filaPintura, 11).value ?? null).toBeNull(); // sin cambios: sin «F»
    const leyenda: string[] = [];
    ws.eachRow((r) => {
      const l = String(r.getCell(1).value ?? "");
      if (/^[A-F]$/.test(l) && r.getCell(2).value) leyenda.push(l);
    });
    expect(leyenda).not.toContain("F");
    expect(leyenda.length).toBeLessThan(6);
  });
  it("el cuadro del Word sin presupuesto lleva OBS y leyenda pero no «Valor ajustado»", async () => {
    const a = parsearActa(await textoPdf(readFileSync(ACTA)));
    const s = salidaBase(a, { conPartidas: true });
    const [t] = cuadroTablaXml({ caso: caso("perdida_determinada"), reclamacion: recl, decisiones: [], adicionales: s.lineas_adicionales, valorUF: 40844.79, recintos: [], siniestrosAnteriores: [] });
    expect(t).toContain("Partida determinada");
    expect(t).toContain(">OBS<");
    expect(t).toContain("Observaciones");
    expect(t).toContain('<w:top w:w="28"'); // 0,05 cm arriba
    expect(t).toContain('<w:left w:w="108"');
    expect(t).not.toContain("Valor ajustado");
  });
});
