import { describe, it, expect } from "vitest";
import { tablasDeFotos, FOTO_EMU, leyendaCorta } from "../lib/docs/fotos-xml";
import { fotosDelAreaAfectada, leyendaDeFoto } from "../lib/docs/fotos-seleccion";
import type { ActaInspeccion } from "../lib/extraccion/acta";

const celdas = (n: number) => Array.from({ length: n }, (_, i) => ({ rid: `rId${i}`, leyenda: `Foto ${i}` }));
const cuenta = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;

describe("fotos del informe: 8,66 × 6,70 cm en cuadrícula de 2 × 3", () => {
  it("cada imagen mide exactamente 8,66 × 6,70 cm", () => {
    expect(FOTO_EMU).toEqual({ cx: 3117600, cy: 2412000 });
    const [t] = tablasDeFotos(celdas(6));
    expect(cuenta(t, /<wp:extent cx="3117600" cy="2412000"\/>/g)).toBe(6);
  });
  it("6 fotos = 1 tabla de 3 filas × 2 columnas; 7 fotos = 2 tablas", () => {
    const [t] = tablasDeFotos(celdas(6));
    expect(cuenta(t, /<w:tr>/g)).toBe(3);
    expect(cuenta(t, /<w:gridCol /g)).toBe(2);
    expect(tablasDeFotos(celdas(7))).toHaveLength(2);
  });
  it("la fachada abre la primera tabla como fila de cabecera centrada (2 columnas) del mismo tamaño", () => {
    const [t] = tablasDeFotos(celdas(6), { fachada: { rid: "rIdF", leyenda: "Fachada" } });
    expect(cuenta(t, /<w:tr>/g)).toBe(4);
    expect(t).toMatch(/<w:gridSpan w:val="2"\/>[\s\S]*rIdF/);
    expect(cuenta(t, /<wp:extent cx="3117600" cy="2412000"\/>/g)).toBe(7);
    const [, t2] = tablasDeFotos(celdas(8), { fachada: { rid: "rIdF", leyenda: "Fachada" } });
    expect(t2).not.toContain("rIdF");
  });
  it("la tabla mide 17,32 cm (2 × 8,66), sin bordes ni márgenes, con título sin espacio y leyenda Times New Roman 10 cursiva centrada", () => {
    const [t] = tablasDeFotos(celdas(6), { titulo: "Living" });
    const ancho = Number(/<w:tblW w:w="(\d+)"/.exec(t)![1]);
    expect((ancho / 1440) * 2.54).toBeCloseTo(17.32, 1);
    expect(t).toContain('<w:left w:w="0"');
    expect(t).not.toContain("<w:tblBorders>");
    expect(t).toMatch(/<w:spacing w:before="0" w:after="0"\/><\/w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman"[^>]*\/><w:b\/><w:i\/><w:sz w:val="24"\/>/);
    expect(t).toMatch(/<w:i\/><w:noProof\/><w:sz w:val="20"\/>/);
  });
  it("la leyenda es de una sola línea (se acorta)", () => {
    expect(leyendaCorta("a".repeat(100)).length).toBeLessThanOrEqual(52);
    expect(leyendaCorta("Living:   cielo\n de madera")).toBe("Living: cielo de madera");
  });
});

describe("selección del área afectada", () => {
  const acta = { danos: [{ recinto: "LIVING", descripcion: "Cielo de madera con filtración", tipoDano: "Filtración" }] } as unknown as ActaInspeccion;
  it("solo fotos de recintos con daño, con tope por recinto", () => {
    const fotos = [..."aaaaaa"].map((_, i) => ({ recinto: "Living", i })).concat([{ recinto: "Baño", i: 99 }]);
    const sel = fotosDelAreaAfectada(fotos, acta, 4);
    expect(sel).toHaveLength(4);
    expect(sel.every((f) => f.recinto === "Living")).toBe(true);
  });
  it("si ninguna foto es de un recinto dañado, se usan todas", () => {
    expect(fotosDelAreaAfectada([{ recinto: "Baño" }, { recinto: "Patio" }], acta)).toHaveLength(2);
  });
  it("leyenda corta con el daño del acta", () => {
    expect(leyendaDeFoto("LIVING", acta)).toBe("Living: cielo de madera con filtración");
    expect(leyendaDeFoto("Patio", acta)).toBe("Patio");
  });
});
