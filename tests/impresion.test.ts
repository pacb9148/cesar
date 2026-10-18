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
});
