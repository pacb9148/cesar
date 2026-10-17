import { describe, it, expect } from "vitest";
import { tablasDeFotos, piezasDeGrupo, FOTO_EMU, leyendaCorta } from "../lib/docs/fotos-xml";
import { fotosDelAreaAfectada, leyendaDeFoto, seleccionarFotosInforme } from "../lib/docs/fotos-seleccion";
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
  it("la tabla mide 17,32 cm (2 × 8,66), sin bordes ni márgenes, con título y leyenda del grupo fuera de la tabla y leyenda Times New Roman 10 cursiva centrada", () => {
    const [t] = tablasDeFotos(celdas(6));
    const ancho = Number(/<w:tblW w:w="(\d+)"/.exec(t)![1]);
    expect((ancho / 1440) * 2.54).toBeCloseTo(17.32, 1);
    expect(t).toContain('<w:left w:w="0"');
    // Sin bordes explícitos y márgenes internos a cero en los cuatro lados, tanto de la tabla como de cada celda.
    expect(cuenta(t, /<w:tblBorders>(<w:(top|left|bottom|right|insideH|insideV) w:val="none"[^>]*[/]>){6}<[/]w:tblBorders>/g)).toBe(1);
    expect(t).toContain('<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>');
    expect(cuenta(t, /<w:tcMar><w:top w:w="0" w:type="dxa"[/]><w:left w:w="0" w:type="dxa"[/]><w:bottom w:w="0" w:type="dxa"[/]><w:right w:w="0" w:type="dxa"[/]><[/]w:tcMar>/g)).toBe(cuenta(t, /<w:tc>/g));
    expect(t).toMatch(/<w:i\/><w:noProof\/><w:sz w:val="20"\/>/);
  });
  it("el título y la leyenda del grupo van en párrafos FUERA de la tabla: título Times 12 negrita cursiva, leyenda Times 10 negrita centrada", () => {
    const p = piezasDeGrupo(celdas(7), { titulo: "Living", pie: "Humedad en cielo y muro" });
    expect(p.map((x) => (x.startsWith("<w:tbl>") ? "tabla" : x.includes("CesarFotoTitulo") ? "titulo" : "pie"))).toEqual(["titulo", "tabla", "titulo", "tabla", "pie"]);
    expect(p[0]).toMatch(/<w:b[/]><w:i[/]><w:sz w:val="24"[/]>/);
    expect(p[2]).toContain("Living (continuación)");
    expect(p[4]).toMatch(/<w:jc w:val="center"[/]>/);
    expect(p[4]).toMatch(/<w:b[/]><w:sz w:val="20"[/]>/);
    // ni el título ni la leyenda del grupo están dentro de ninguna tabla
    for (const t of [p[1], p[3]]) {
      expect(t).not.toContain("Living");
      expect(t).not.toContain("Humedad en cielo y muro");
    }
  });
  it("la leyenda es opcional: sin texto no sale ninguna, con texto sale una línea", () => {
    const [sin] = tablasDeFotos([{ rid: "a", leyenda: "" }, { rid: "b", leyenda: "  " }]);
    expect(sin).not.toContain("<w:noProof/>");
    const [con] = tablasDeFotos([{ rid: "a", leyenda: "Cielo con mancha" }]);
    expect(con).toContain("Cielo con mancha");
  });
  it("la foto quitada por el usuario no entra ni por la selección automática", () => {
    const acta = { danos: [{ recinto: "LIVING", descripcion: "x", tipoDano: "y" }] } as unknown as ActaInspeccion;
    const fotos = [{ recinto: "Living", id: 1, edicion: { excluir: true } }, { recinto: "Living", id: 2, edicion: null }];
    expect(seleccionarFotosInforme(fotos, acta).fotos.map((f) => f.id)).toEqual([2]);
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

describe("orden de las estancias según el presupuesto", () => {
  it("sigue el orden de las secciones del presupuesto, sin importar mayúsculas ni tildes; lo que no coincide va al final", async () => {
    const { ordenarGruposPorPresupuesto } = await import("../lib/fotos/orden");
    const f = (id: number, recinto: string) => ({ id, recinto });
    const fotos = [f(1, "Baño 1"), f(2, "Cocina"), f(3, "dormitorio 1"), f(4, "Terraza"), f(5, "Dormitorio 1"), f(6, "Living")];
    const r = ordenarGruposPorPresupuesto(fotos, ["DORMITORIO 1", "LIVING COMEDOR", "COCINA", "BAÑO 1"]);
    expect(r.map((x) => x.id)).toEqual([3, 5, 6, 2, 1, 4]);
  });
  it("sin presupuesto deja el orden como está", async () => {
    const { ordenarGruposPorPresupuesto } = await import("../lib/fotos/orden");
    const fotos = [{ recinto: "B" }, { recinto: "A" }];
    expect(ordenarGruposPorPresupuesto(fotos, [])).toBe(fotos);
  });
});

describe("arrastrar y soltar fotos", () => {
  it("la foto arrastrada ocupa el lugar de la de destino, hacia delante o hacia atrás", async () => {
    const { soltarFoto } = await import("../lib/fotos/orden");
    expect(soltarFoto(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(soltarFoto(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(soltarFoto(["a", "b", "c"], "x", "b")).toEqual(["a", "x", "b", "c"]); // una foto que no iba entra en esa posición
    expect(soltarFoto(["a", "b"], "a", "z")).toEqual(["a", "b"]);
    expect(soltarFoto(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
});
