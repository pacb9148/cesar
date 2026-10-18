import { describe, it, expect } from "vitest";
import type { HojaVista } from "../lib/docs/vista-xlsx";
import { hojaAHtml } from "../lib/docs/impresion-html";

const celda = (r: number, c: number, txt: string, extra: Record<string, unknown> = {}) => ({ r, c, txt, raw: txt, ...extra });
const hoja: HojaVista = {
  nombre: "EDIFICIO",
  filas: 24,
  columnas: 40,
  anchos: [60, 500, 50, 70, 90, 100, 8, 10, 13, 15, 30, 30, 30, ...Array(27).fill(64)],
  altos: [],
  ajusteTexto: false,
  combinadas: [{ r1: 10, c1: 3, r2: 10, c2: 6 }, { r1: 10, c1: 11, r2: 11, c2: 13 }],
  celdas: [
    celda(1, 1, "Evento:"), celda(1, 2, "Temporal"),
    celda(10, 1, "Ítem", { b: true, fondo: "#d9d9d9" }), celda(10, 3, "Partida determinada", { b: true, fondo: "#d9d9d9" }), celda(10, 11, "OBS", { b: true, fondo: "#d9d9d9" }),
    celda(11, 3, "u/m"), celda(11, 4, "Cant."), celda(11, 6, "Total ($)"),
    celda(12, 1, "1.0", { b: true }), celda(12, 2, "DORMITORIO 1", { fondo: "#f2f2f2" }),
    celda(13, 2, "Pintura & <viento>"), celda(13, 3, "m2"), celda(13, 4, "7,8"), celda(13, 6, "16.848"), celda(13, 11, "B"), celda(13, 12, "C"),
    celda(20, 2, "Total directo ($)"), celda(20, 6, "770.382"),
    celda(21, 2, "Equivalente en moneda de póliza (UF)"), celda(21, 6, "28,06"),
    celda(22, 2, "Valor a indemnizar (UF)", { b: true }), celda(22, 6, "28,06", { b: true }),
  ],
};

describe("vista de impresión del Excel", () => {
  it("no imprime los datos del siniestro y repite los títulos de la tabla sin partir filas", () => {
    const h = hojaAHtml(hoja);
    expect(h).not.toContain("Evento:");
    expect(h).not.toContain("Temporal");
    expect(h).toContain("<thead>");
    const thead = /<thead>([^]*?)<[/]thead>/.exec(h)![1];
    expect(thead).toContain("Partida determinada");
    expect(thead).toContain("u/m");
    expect(thead).toContain("OBS");
    expect(thead).not.toContain("DORMITORIO 1");
    expect(h).toContain("page-break-inside: avoid");
  });
  it("omite las columnas sin texto y ajusta el ancho de lo combinado a las columnas visibles", () => {
    const h = hojaAHtml(hoja);
    // Con texto: 1, 2, 3, 4, 6, 11 y 12 (las columnas 5, 7–10 y 13 están vacías).
    expect((h.match(/<col /g) ?? []).length).toBe(7);
    expect(h).toContain('colspan="3" rowspan="1"'); // «Partida determinada»: columnas 3, 4 y 6
    expect(h).toContain('colspan="2" rowspan="2"'); // OBS: columnas 11 y 12
  });
  it("elige hoja horizontal si es ancha, escala para caber y escapa el texto", () => {
    const h = hojaAHtml(hoja);
    expect(h).toContain("size: A4 landscape");
    expect(h).toContain("Pintura &amp; &lt;viento&gt;");
    expect(hojaAHtml(hoja, { orientacion: "vertical" })).toContain("size: A4 portrait");
    const zoom = Number(/zoom: ([0-9.]+)/.exec(hojaAHtml(hoja, { orientacion: "vertical" }))![1]);
    expect(zoom).toBeLessThan(1);
  });
  it("las cifras van a la derecha y no hay sombreado en ninguna celda", () => {
    const h = hojaAHtml(hoja);
    expect(h).toMatch(/text-align:right[^"]*">7,8</);
    expect(h).not.toMatch(/background:#/); // el sombreado en línea de las celdas
  });
  it("títulos en recuadro, líneas solo en el bloque de totales y 0,19 cm de margen a la izquierda y arriba", () => {
    const h = hojaAHtml(hoja);
    expect(h).toContain("border: 0;");
    expect(h).not.toContain("border: 1px solid #d4d4d8");
    const thead = /<thead>([^]*?)<[/]thead>/.exec(h)![1];
    expect(thead).toContain("border:1px solid #000");
    const fila = (txt: string) => new RegExp(`<tr[^>]*>(?:(?!<[/]tr>)[^])*${txt}[^]*?<[/]tr>`).exec(h)![0];
    expect(fila("Total directo")).toContain("border-top:1px solid #000");
    expect(fila("Equivalente")).toContain("border-bottom:1px solid #000");
    expect(fila("Valor a indemnizar")).toContain("border-bottom:3px double #000");
    expect(fila("DORMITORIO 1")).not.toContain("border");
    expect(h).toContain("padding: 7px 0 0 7px"); // hoja
    expect(h).toMatch(/td \{ padding: 2px 4px 2px 7px;/); // celdas
  });
  it("ajusta al contenido las columnas cortas (u/m, cantidad, precio, total) y no parte fechas ni cifras", () => {
    const h: HojaVista = {
      ...hoja,
      combinadas: [],
      anchos: [60, 500, 50, 120, 160, 200],
      celdas: [celda(11, 3, "u/m"), celda(11, 4, "Cant."), celda(11, 5, "P. Unit. ($)"), celda(11, 6, "Total ($)"), celda(13, 2, "Una descripción de trabajos que es bastante larga y puede partirse"), celda(13, 3, "m2"), celda(13, 4, "7,8"), celda(13, 5, "4.680"), celda(13, 6, "1.145.943"), celda(20, 3, "01-08-2026"), celda(21, 3, "40.844,79")],
    };
    const html = hojaAHtml(h);
    const anchos = [...html.matchAll(/<col style="width:(\d+)px">/g)].map((m) => Number(m[1]));
    // Columnas visibles: 2 (descripción), 3 (u/m), 4 (cantidad), 5 (precio) y 6 (total).
    expect(anchos[0]).toBe(500); // la descripción conserva su ancho y puede partirse
    expect(anchos[1]).toBeGreaterThanOrEqual(70); // u/m crece para que quepa una fecha
    expect(anchos[2]).toBeLessThan(120); // cantidad deja de sobrar
    expect(anchos[3]).toBeLessThan(160);
    expect(anchos[4]).toBeLessThan(200);
    expect(html).toContain("white-space:nowrap");
  });
});
