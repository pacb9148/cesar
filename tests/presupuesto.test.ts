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

describe("presupuesto PDF con capítulos numerados, unidades de compra y datos de portada (caso Espino 2503)", () => {
  const texto = [
    "Presupuesto de obras reparación techumbre (cubierta) y cielo raso;",
    "Sr. René Chamorro Villalobos",
    "El Espino 2503, Las Araucarias, Tomé.",
    "Fono: 995329352",
    "Fecha: 19 de agosto de 2026",
    "Item Partida Unidad Cantidad P.U. Total",
    "1 Desarme cubierta",
    "1.1 Retiro y disposición de escombros gl 1 $ 270.000 $ 270.000",
    "1.2 Mano de obra gl 1 $ 500.000 $ 500.000",
    "2 Reparación y reposición de cubierta",
    "2.1 Tableros OSB estructurales 15 mm uni 38 $ 23.290 $ 884.020",
    "2.2 Membrana hidrófuga Tyvek uni 2 $ 121.900 $ 243.800",
    "2.3 Zinc acanalado 0,35 mm uni 37 $ 14.290 $ 528.730",
    "2.4 Costaneras impregnadas uni 60 $ 3.190 $ 191.400",
    "2.5 Tornillos y fijaciones caja 3 $ 33.590 $ 100.770",
    "2.6 Selladores y siliconas uni 8 $ 9.990 $ 79.920",
    "2.7 Canaletas uni 8 $ 19.990 $ 159.920",
    "2.8 Bajadas ALL uni 8 $ 8.290 $ 66.320",
    "2.9 Caballetes uni 5 $ 23.030 $ 115.150",
    "2.10 Tapacanes metálicos y madera uni 8 $ 11.450 $ 91.600",
    "2.11 Mano de obra gl 1 $ 2.900.000 $ 2.900.000",
    "3 Desarme cielos interiores",
    "3.1 Retiro y disposición de escombros gl 1 $ 270.000 $ 270.000",
    "3.2 Mano de obra gl 1 $ 280.000 $ 280.000",
    "Reparación y reposición cielo Living - comedor,",
    "4 dormitorio N°1 y N°2",
    "4.1 Planchas para reposición de cielos uni 14 10320 144480",
    "4.2 Perfiles metálicos, fijaciones y tornillería gl 1 220000 220000",
    "4.3 Pasta muro y materiales de empaste m2 35 3285 114975",
    "4.4 Selladores antihumedad galon 1 120000 120000",
    "4.5 Pintura premium para cielos galon 1 129000 129000",
    "4.6 Pintura premium para muros galon 1 129000 129000",
    "4.7 Insumos menores, plásticos y protecciones gl 1 140000 140000",
    "4.8 Mano de obra gl 1 $ 1.180.000 $ 1.180.000",
    "Costo directo $ 8.860.085",
    "Gastos generales 20% $ 1.772.017",
    "Utilidades 15% $ 1.329.013",
    "Subtotal $ 11.961.115",
    "IVA $ 2.272.612",
    "TOTAL $ 14.233.727",
    "Nora Arteaga Sepúlveda",
    "Ingeniero Constructor",
  ];
  const r = parsearPresupuestoPdf([texto.join("\n")]).reclamacion;
  const alertas = parsearPresupuestoPdf([texto.join("\n")]).alertas;

  it("los datos del destinatario, la fecha y la firma no son secciones ni partidas", () => {
    const titulos = r.secciones.map((s) => s.titulo);
    for (const t of titulos) expect(t).not.toMatch(/Ren[eé]|Espino|Fono|Fecha|Ingeniero|Nora|Presupuesto de obras/i);
    expect(r.lineas.some((l) => /Chamorro|Fono|Fecha|Ingeniero/i.test(l.descripcion))).toBe(false);
  });
  it("cada capítulo es una sección y sus elementos son líneas con su cantidad y precio", () => {
    expect(r.secciones.map((s) => s.titulo)).toEqual(["Desarme cubierta", "Reparación y reposición de cubierta", "Desarme cielos interiores", "Reparación y reposición cielo Living - comedor, dormitorio N°1 y N°2"]);
    expect(r.lineas).toHaveLength(2 + 11 + 2 + 8);
    const cap4 = r.lineas.filter((l) => l.recinto.startsWith("Reparación y reposición cielo"));
    expect(cap4.map((l) => l.item)).toEqual(["4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8"]);
    expect(cap4[0]).toMatchObject({ descripcion: "Planchas para reposición de cielos", um: "un", cantidad: 14, pu: 10320 });
    expect(cap4[2]).toMatchObject({ um: "m2", cantidad: 35, pu: 3285 });
    expect(r.lineas.some((l) => /^\d+\.\d+\s/.test(l.descripcion))).toBe(false); // sin el número del ítem pegado a la descripción
  });
  it("las unidades de compra (uni, galón, caja) se leen, y la palabra original queda anotada", () => {
    const l = (d: string) => r.lineas.find((x) => x.descripcion.startsWith(d))!;
    expect(l("Tableros OSB")).toMatchObject({ um: "un", cantidad: 38, pu: 23290 });
    expect(l("Tableros OSB").descripcion).not.toMatch(/\(/);
    expect(l("Selladores antihumedad").descripcion).toMatch(/\(galón\)$/);
    expect(l("Tornillos y fijaciones").descripcion).toMatch(/\(caja\)$/);
  });
  it("la suma de las partidas coincide con el costo directo declarado y no quedan alertas", () => {
    expect(r.lineas.reduce((s, x) => s + x.cantidad * x.pu, 0)).toBe(8860085);
    expect(r.totalDirectoDeclarado).toBe(8860085);
    expect(alertas).toEqual([]);
  });
  it("también lee el título partido con el número en la primera línea y una descripción larga partida en dos filas", () => {
    const otro = parsearPresupuestoPdf([["Item Partida Unidad Cantidad P.U. Total", "4 Reparación y reposición cielo Living - comedor,", "dormitorio N°1 y N°2", "4.1 Perfiles metálicos, fijaciones y", "tornillería gl 1 220000 220000", "4.2 Mano de obra gl 1 100000 100000", "Costo directo $ 320.000"].join(String.fromCharCode(10))]);
    expect(otro.reclamacion.secciones.map((x) => x.titulo)).toEqual(["Reparación y reposición cielo Living - comedor, dormitorio N°1 y N°2"]);
    expect(otro.reclamacion.lineas.map((x) => x.descripcion)).toEqual(["Perfiles metálicos, fijaciones y tornillería", "Mano de obra"]);
    expect(otro.alertas).toEqual([]);
  });
});
