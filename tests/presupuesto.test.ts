import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { textoPdf } from "../lib/extraccion/pdf";
import { parsearPresupuestoPdf, parsearPresupuestoXlsx, numeroCL } from "../lib/extraccion/presupuesto";

const f = (p: string) => globSync(`fuente/${p}`)[0];
const suma = (r: { lineas: { cantidad: number; pu: number }[] }) => r.lineas.reduce((s, l) => s + l.cantidad * l.pu, 0);

describe("presupuesto del contratista", () => {
  it("numeroCL", () => {
    expect([numeroCL("$5.500"), numeroCL("9,52"), numeroCL("1,"), numeroCL("11.701.639")]).toEqual([5500, 9.52, 1, 11701639]);
  });
  it("caso 1 (Excel): 40 partidas y $5.716.010 de costo directo", async () => {
    const r = await parsearPresupuestoXlsx(readFileSync(f("1981023*/DOCUMENTOS/*Presupuesto.xlsx")));
    expect(r.reclamacion.lineas).toHaveLength(40);
    expect(suma(r.reclamacion)).toBeCloseTo(5716010.32, 1);
    expect(r.reclamacion.ggPct).toBe(0.25);
    expect(r.alertas).toEqual([]);
  });
  it("caso 3 (PDF): $8.060.090 con GG 12 % y utilidad 10 %", async () => {
    const r = parsearPresupuestoPdf(await textoPdf(readFileSync(f("1984673*/DOCUMENTOS/Presupuesto*.pdf"))));
    expect(Math.round(suma(r.reclamacion))).toBe(8060090);
    expect([r.reclamacion.ggPct, r.reclamacion.utilidadPct]).toEqual([0.12, 0.1]);
    expect(r.reclamacion.lineas.length).toBe(59);
  });
  it("caso 4 (PDF): $5.147.340, y señala la línea de cubierta mal extraída", async () => {
    const r = parsearPresupuestoPdf(await textoPdf(readFileSync(f("1984853*/DOCUMENTOS/_-*.pdf"))));
    expect(r.reclamacion.totalDirectoDeclarado).toBe(5147340);
    expect(r.reclamacion.lineas).toHaveLength(45);
    expect(Math.round(suma(r.reclamacion))).toBe(5147340);
    expect(r.alertas).toEqual([]);
  });
});

describe("presupuesto con otros títulos de columna (caso 1990660)", () => {
  it("lee las 68 partidas aunque el precio se llame «Costo uni», sin tratar «Valor Obra» como recinto", async () => {
    const r = await parsearPresupuestoXlsx(readFileSync(f("1990660*/DOCUMENTOS/Presupuesto*.xlsx")));
    expect(r.reclamacion.lineas).toHaveLength(68);
    expect(suma(r.reclamacion)).toBeCloseTo(6189086, 0);
    expect(r.reclamacion.totalDirectoDeclarado).toBe(6189086);
    expect(r.reclamacion.secciones.map((s) => s.titulo)).toEqual(["Cocina", "Dormitorio 1", "Living comedor", "Caja escala", "Dormitorio 2 segundo piso", "Dormitorio 3 segundo piso", "Otros"]);
    expect([r.reclamacion.ggPct, r.reclamacion.utilidadPct, r.reclamacion.ivaPct]).toEqual([0.25, 0, 0.19]);
    expect(r.alertas).toEqual([]);
  });
  it("conserva los recintos del caso 1 aunque traigan medidas en columnas previas a la unidad", async () => {
    const r = await parsearPresupuestoXlsx(readFileSync(f("1981023*/DOCUMENTOS/*Presupuesto.xlsx")));
    expect(r.reclamacion.secciones).toHaveLength(8);
  });
});
