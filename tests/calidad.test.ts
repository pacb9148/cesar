import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { CALIDAD_POR_DEFECTO, esCalidad, pxDeCalidad } from "../lib/fotos/calidad";
import { fotoFinal } from "../lib/fotos/procesar";

const jpg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 100, b: 50 } } }).jpeg().toBuffer();

describe("calidad de entrega de las fotos", () => {
  it("el valor recomendado es 150 ppp y solo se aceptan 150 y 300", () => {
    expect(CALIDAD_POR_DEFECTO).toBe("150");
    expect(esCalidad("150")).toBe(true);
    expect(esCalidad("300")).toBe(true);
    expect(esCalidad("72")).toBe(false);
  });
  it("300 ppp da el doble de ancho que 150 ppp con la proporción 8,66 × 6,70", () => {
    expect(pxDeCalidad("300").ancho).toBe(2 * pxDeCalidad("150").ancho);
    const p = pxDeCalidad("150");
    expect(p.ancho / p.alto).toBeCloseTo(8.66 / 6.7, 1);
  });
  it("la foto final sale con las dimensiones de la calidad elegida y pesa menos a 150 ppp", async () => {
    const origen = { recinto: "Living", buffer: await jpg(3000, 2000) };
    const a150 = (await fotoFinal(origen, "150"))!;
    const a300 = (await fotoFinal(origen, "300"))!;
    const m150 = await sharp(a150).metadata();
    const m300 = await sharp(a300).metadata();
    expect(m150.width).toBe(pxDeCalidad("150").ancho);
    expect(m300.width).toBe(pxDeCalidad("300").ancho);
    expect(a150.length).toBeLessThan(a300.length);
    expect(m150.exif).toBeUndefined();
  });
  it("una foto corrupta devuelve null en vez de romper el documento, y la carga perezosa funciona", async () => {
    expect(await fotoFinal({ recinto: "X", buffer: Buffer.from("no soy una imagen") })).toBeNull();
    expect(await fotoFinal({ recinto: "X" })).toBeNull();
    const buf = await jpg(800, 600);
    expect(await fotoFinal({ recinto: "X", cargar: async () => buf }, "150")).not.toBeNull();
  });
});
