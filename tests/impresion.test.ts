import { describe, it, expect } from "vitest";
import type { HojaVista } from "../lib/docs/vista-xlsx";
import { hojaAHtml } from "../lib/docs/impresion-html";

const celda = (r: number, c: number, txt: string, extra: Record<string, unknown> = {}) => ({ r, c, txt, raw: txt, ...extra });
const hoja: HojaVista = {
  nombre: "EDIFICIO",
  filas: 14,
  columnas: 40,
  anchos: [60, 500, 50, 70, 90, 100, ...Array(34).fill(64)],
  altos: [],
  ajusteTexto: false,
  combinadas: [{ r1: 10, c1: 3, r2: 10, c2: 6 }],
  celdas: [
    celda(1, 1, "Evento:"), celda(1, 2, "Temporal & <viento>"),
    celda(10, 1, "Ítem", { b: true, fondo: "#d9d9d9" }), celda(10, 3, "Partida determinada", { b: true, fondo: "#d9d9d9" }),
    celda(11, 3, "u/m"), celda(11, 4, "Cant."),
    celda(12, 1, "1.0", { b: true }), celda(12, 2, "DORMITORIO 1"),
    celda(13, 2, "Pintura"), celda(13, 4, "7,8"), celda(13, 6, "16.848"),
  ],
};

describe("vista de impresión del Excel", () => {
  it("recorta al área con contenido, repite los títulos de la tabla y no parte filas", () => {
    const h = hojaAHtml(hoja);
    expect((h.match(/<col /g) ?? []).length).toBe(6); // solo hasta la última columna con texto
    expect(h).toContain("<thead>");
    const thead = /<thead>([^]*?)<[/]thead>/.exec(h)![1];
    expect(thead).toContain("Partida determinada");
    expect(thead).toContain("u/m");
    expect(thead).not.toContain("DORMITORIO 1");
    expect(h).toContain("page-break-inside: avoid");
    expect(h).toContain('colspan="4" rowspan="1"'); // «Partida determinada» abarca sus cuatro columnas
  });
  it("elige hoja horizontal si es ancha, escala para caber y escapa el texto", () => {
    const h = hojaAHtml(hoja);
    expect(h).toContain("size: A4 landscape");
    expect(h).toContain("Temporal &amp; &lt;viento&gt;");
    expect(hojaAHtml(hoja, { orientacion: "vertical" })).toContain("size: A4 portrait");
    const zoom = Number(/zoom: ([0-9.]+)/.exec(hojaAHtml(hoja, { orientacion: "vertical" }))![1]);
    expect(zoom).toBeLessThan(1);
  });
  it("las cifras van a la derecha y las celdas con fondo mantienen texto legible", () => {
    const h = hojaAHtml(hoja);
    expect(h).toMatch(/text-align:right">7,8</);
    expect(h).toMatch(/background:#d9d9d9;color:#[0-9a-f]{3,6};font-weight:700/i);
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
    const col = (n: number) => anchos[n - 1];
    expect(col(3)).toBeGreaterThanOrEqual(70); // u/m crece para que quepa una fecha
    expect(col(4)).toBeLessThan(120); // cantidad deja de sobrar
    expect(col(5)).toBeLessThan(160);
    expect(col(6)).toBeLessThan(200);
    expect(col(2)).toBe(500); // la descripción conserva su ancho y puede partirse
    expect(html).toContain("white-space:nowrap");
  });
});
