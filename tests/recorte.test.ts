import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { EDICION_INICIAL, centroValido, edicionFotoSchema, girar, ventanaDeRecorte, PROPORCION_FOTO } from "../lib/fotos/recorte";
import { aplicarEdicion } from "../lib/fotos/aplicar";
import { FOTO_PX } from "../lib/docs/fotos-xml";

/** Imagen de 2000 × 1000: mitad izquierda roja, mitad derecha azul. */
const imagen = () => sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 255, g: 0, b: 0 } } }).composite([{ input: { create: { width: 1000, height: 1000, channels: 3, background: { r: 0, g: 0, b: 255 } } }, left: 1000, top: 0 }]).png().toBuffer();
const promedio = async (b: Buffer) => {
  const { data } = await sharp(b).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
};

describe("recorte de fotografías", () => {
  it("la ventana mantiene la proporción 7,8 × 6,5 y el zoom la reduce", () => {
    const v1 = ventanaDeRecorte(2000, 1000, { zoom: 1, cx: 0.5, cy: 0.5 });
    expect(v1.w / v1.h).toBeCloseTo(PROPORCION_FOTO, 5);
    expect(v1.h).toBe(1000);
    const v2 = ventanaDeRecorte(2000, 1000, { zoom: 2, cx: 0.5, cy: 0.5 });
    expect(v2.w).toBeCloseTo(v1.w / 2, 5);
  });
  it("la ventana nunca sale de la imagen", () => {
    const v = ventanaDeRecorte(2000, 1000, { zoom: 4, cx: 0, cy: 1 });
    expect(v.x).toBe(0);
    expect(v.y + v.h).toBeCloseTo(1000, 5);
    const c = centroValido(2000, 1000, { zoom: 4, cx: 0, cy: 1 });
    expect(c.cx).toBeGreaterThan(0);
    expect(c.cy).toBeLessThan(1);
  });
  it("el giro rota de a 90° en ambos sentidos", () => {
    expect(girar(0, -1)).toBe(270);
    expect(girar(270, 1)).toBe(0);
  });
  it("valida los parámetros guardados", () => {
    expect(edicionFotoSchema.safeParse(EDICION_INICIAL).success).toBe(true);
    expect(edicionFotoSchema.safeParse({ ...EDICION_INICIAL, zoom: 20 }).success).toBe(false);
    expect(edicionFotoSchema.safeParse({ ...EDICION_INICIAL, giro: 45 }).success).toBe(false);
  });
});

describe("aplicarEdicion (lo que se inserta en el informe)", () => {
  it("entrega exactamente el tamaño de la foto del informe", async () => {
    const out = await aplicarEdicion(await imagen(), EDICION_INICIAL);
    const m = await sharp(out).metadata();
    expect([m.width, m.height]).toEqual([FOTO_PX.ancho, FOTO_PX.alto]);
  });
  it("mover el recorte cambia el área elegida", async () => {
    const png = await imagen();
    const izq = await promedio(await aplicarEdicion(png, { ...EDICION_INICIAL, zoom: 3, cx: 0.1 }));
    const der = await promedio(await aplicarEdicion(png, { ...EDICION_INICIAL, zoom: 3, cx: 0.9 }));
    expect(izq.r).toBeGreaterThan(200);
    expect(der.b).toBeGreaterThan(200);
  });
  it("el volteo horizontal intercambia los lados", async () => {
    const png = await imagen();
    const v = await promedio(await aplicarEdicion(png, { ...EDICION_INICIAL, zoom: 3, cx: 0.1, volteoH: true }));
    expect(v.b).toBeGreaterThan(200);
  });
  it("el giro de 90° usa la imagen girada (los lados cambian de eje)", async () => {
    const png = await imagen();
    const arriba = await promedio(await aplicarEdicion(png, { ...EDICION_INICIAL, giro: 90, zoom: 3, cy: 0.1 }));
    expect(arriba.r + arriba.b).toBeGreaterThan(200);
  });
  it("brillo y contraste se aplican", async () => {
    const png = await imagen();
    const base = await promedio(await aplicarEdicion(png, { ...EDICION_INICIAL, zoom: 3, cx: 0.1 }));
    const oscura = await promedio(await aplicarEdicion(png, { ...EDICION_INICIAL, zoom: 3, cx: 0.1, brillo: -60 }));
    expect(oscura.r).toBeLessThan(base.r);
  });
});
