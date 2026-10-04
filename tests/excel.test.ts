import { describe, it, expect } from "vitest";
import { globSync, writeFileSync } from "node:fs";
import { leerPlanilla } from "../lib/extraccion/planilla";
import { generarExcel } from "../lib/docs/excel";
import { datosCasoSchema } from "../lib/domain/tipos";

describe("generarExcel", () => {
  it("round-trip del caso 1: lo generado se lee y da UF 46,73", async () => {
    const orig = await leerPlanilla(globSync("fuente/1981023*/1981023 Ajuste v1.xlsx")[0]);
    const caso = datosCasoSchema.parse({
      siniestro: "1981023",
      liquidacion: "170448",
      aseguradora: "HDI Seguros S.A",
      asegurado: { nombre: "Juan Antonio Riquelme Muñoz", rut: "17.897.486-6", direccion: "Huérfanos 1751, Concepción" },
      beneficiario: { nombre: "Banco del Estado de Chile S.A.", rut: "97.030.000-7", direccion: "Av. Libertador Bernardo O’Higgins 1111, Santiago" },
      poliza: { tipo: "Incendio", numero: "20580183", item: "4", vigenciaDesde: "01/10/2024", vigenciaHasta: "30/09/2026", materia: "Edificio casa habitacional", sumaAseguradaUF: 1294, deducibleUF: 0 },
      ubicacion: "Huérfanos 1751, Concepción, Región del Biobío",
      comuna: "Concepción",
      region: "Región del Biobío",
      fechas: { inspeccion: "07/08/2026", asignacion: "29/07/2026", denuncia: "29/07/2026", ocurrencia: "2026-07-16", emision: "24/08/2026", informadoPartes: null },
      denunciaTexto: null,
      modo: "reclamacion",
    });
    const buf = await generarExcel({
      caso,
      reclamacion: orig.reclamacion,
      decisiones: orig.decisiones,
      adicionales: orig.adicionales,
      valorUF: orig.valorUF!,
      recintos: [{ nombre: "Living", alto: 2.4, largo: 3.2, ancho: 3.2 }],
      siniestrosAnteriores: [],
    });
    writeFileSync("tmp/caso1-generado.xlsx", buf);
    const rt = await leerPlanilla(buf);
    expect(rt.ufCalculadoReclamacion).toBeCloseTo(208.17, 1);
    expect(rt.ufCalculadoAjuste).toBeCloseTo(46.73, 1);
    expect(rt.decisiones.length).toBe(orig.decisiones.length);
  });
});

describe("cuadro de pérdida como tabla de Word (sin navegador)", () => {
  it("es XML bien formado con las filas, los totales y la leyenda", async () => {
    const { cuadroTablaXml } = await import("../lib/docs/cuadro");
    const { DOMParser } = await import("@xmldom/xmldom");
    const orig = await leerPlanilla(globSync("fuente/1981023*/1981023 Ajuste v1.xlsx")[0]);
    const caso = datosCasoSchema.parse({
      siniestro: "1981023", liquidacion: "170448", aseguradora: "HDI", asegurado: { nombre: "X", rut: "1", direccion: "d" }, beneficiario: { nombre: "B", rut: "2", direccion: "d" },
      poliza: { tipo: "Incendio", numero: "1", item: "4", vigenciaDesde: "01/10/2024", vigenciaHasta: "30/09/2026", materia: "m", sumaAseguradaUF: 1294, deducibleUF: 0 },
      ubicacion: "u", comuna: "c", region: "r",
      fechas: { inspeccion: "07/08/2026", asignacion: "29/07/2026", denuncia: "29/07/2026", ocurrencia: "2026-07-16", emision: null, informadoPartes: null }, denunciaTexto: null, modo: "reclamacion",
    });
    const partes = cuadroTablaXml({ caso, reclamacion: orig.reclamacion, decisiones: orig.decisiones, adicionales: orig.adicionales, valorUF: orig.valorUF!, recintos: [], siniestrosAnteriores: [] });
    const xml = `<w:body xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${partes.join("")}</w:body>`;
    const errores: string[] = [];
    new DOMParser({ onError: (_n: string, m: string) => errores.push(m) } as never).parseFromString(xml, "text/xml");
    expect(errores).toEqual([]);
    expect(partes[0]).toContain("Valor a indemnizar (UF)");
    expect(partes[0]).toContain("46,73");
    expect((partes[0].match(/<w:tr>/g) ?? []).length).toBeGreaterThan(orig.reclamacion.lineas.length);
    expect(partes.join("")).toContain("Daños por mantenimiento");
  });
});
