import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { textoPdf } from "../lib/extraccion/pdf";
import { parsearActa } from "../lib/extraccion/acta";
import { parsearProvision } from "../lib/extraccion/provision";

const pdf = (p: string) => textoPdf(readFileSync(globSync(`fuente/${p}`)[0]));

describe("parser del acta", () => {
  it("caso 1: identificación y 7 recintos", async () => {
    const a = parsearActa(await pdf("1981023*/TEXTO/INSP*.pdf"));
    expect(a.siniestro).toBe("1981023");
    expect(a.rut).toBe("17.897.486-6");
    expect(a.fechaInspeccion).toBe("07-08-2026");
    expect(a.danos.map((d) => [d.recinto, d.cantidad])).toEqual([
      ["Living", 22], ["Comedor", 22], ["Dormitorio 1", 27], ["Dormitorio 2", 32], ["Logia", 4], ["Cubierta", 50], ["Fachada Lateral", 7],
    ]);
  });
  it("caso 2: descripción del inmueble", async () => {
    const a = parsearActa(await pdf("1984654*/TEXTO/INSP*.pdf"));
    expect([a.pisos, a.dormitorios, a.banos, a.superficieM2, a.antiguedad]).toEqual([2, 3, 1, 90, 18]);
    expect(a.sistemaEstructural).toBe("Albañileria de ladrillos");
    expect(a.danos.map((d) => d.cantidad)).toEqual([28, 22.7, 7.02, 26.7, 22.68]);
  });
  it("caso 3: filas con descripción de varias líneas", async () => {
    const a = parsearActa(await pdf("1984673*/TEXTO/INSP*.pdf"));
    expect(a.danos.length).toBeGreaterThanOrEqual(6);
    expect(a.danos[0]).toMatchObject({ recinto: "cobertizo", cantidad: 17.82, tipoDano: "Afectado por agua" });
    expect(a.danos[1].cantidad).toBe(15.4);
    expect(a.danos[2].cantidad).toBe(5.6);
  });
  it("caso 4: seis recintos y cuatro valores faltantes en blanco", async () => {
    const a = parsearActa(await pdf("1984853*/TEXTO/INSP*.pdf"));
    expect(a.danos.map((d) => [d.recinto, d.cantidad])).toEqual([
      ["Dormitorio 1", 6], ["Dormitorio 2", 6], ["Dormitorio 3", 6], ["Caja Escala", 2], ["Baño 1", 2], ["Living Comedor", 8],
    ]);
    expect(a.antiguedad).toBe(7);
  });
});

describe("parser de la provisión", () => {
  it("lee póliza, ítem, vigencia y suma asegurada", async () => {
    const p = parsearProvision(await pdf("1984673*/TEXTO/*Provisi*.pdf"));
    expect(p).toMatchObject({ polizaNumero: "20580183", polizaItem: "5", sumaAseguradaUF: 675, vigenciaDesde: "01/10/2024", vigenciaHasta: "30/09/2026" });
    expect(p.liquidacion).toBe("172270");
    expect(p.asegurado.rut).toBe("11.482.710-K");
  });
  it("caso 4: póliza 20580184 ítem 5", async () => {
    const p = parsearProvision(await pdf("1984853*/TEXTO/*Provisi*.pdf"));
    expect([p.polizaNumero, p.polizaItem, p.sumaAseguradaUF, p.fechaOcurrencia]).toEqual(["20580184", "5", 2023, "16/07/2026"]);
  });
});
