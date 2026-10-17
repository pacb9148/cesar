import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { EDICION_INICIAL, ZOOM_MAX, esEdicionNula, lienzoRotado, centroValido, edicionFotoSchema, encuadreDeRectangulo, girar, ventanaBase, ventanaDeRecorte, PROPORCION_FOTO } from "../lib/fotos/recorte";
import { aplicarEdicion } from "../lib/fotos/aplicar";
import { FOTO_PX } from "../lib/docs/fotos-xml";

/** Imagen de 2000 × 1000: mitad izquierda roja, mitad derecha azul. */
const imagen = () => sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 255, g: 0, b: 0 } } }).composite([{ input: { create: { width: 1000, height: 1000, channels: 3, background: { r: 0, g: 0, b: 255 } } }, left: 1000, top: 0 }]).png().toBuffer();
const promedio = async (b: Buffer) => {
  const { data } = await sharp(b).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
};

describe("recorte de fotografías", () => {
  it("la ventana mantiene la proporción 8,66 × 6,70 y el zoom la reduce", () => {
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

describe("marco flexible: encuadre de un rectángulo", () => {
  it("un detalle pequeño amplía el marco y queda centrado en él", () => {
    const e = encuadreDeRectangulo(2000, 1000, { x: 1400, y: 300, w: 200, h: 200 });
    const v = ventanaDeRecorte(2000, 1000, e);
    expect(e.zoom).toBeGreaterThan(2);
    expect(v.x).toBeLessThanOrEqual(1400);
    expect(v.x + v.w).toBeGreaterThanOrEqual(1600);
    expect(v.y).toBeLessThanOrEqual(300);
    expect(v.y + v.h).toBeGreaterThanOrEqual(500);
    expect(v.w / v.h).toBeCloseTo(PROPORCION_FOTO, 5);
  });
  it("un rectángulo mayor que el marco base deja el zoom en 1 y uno diminuto no pasa del máximo", () => {
    expect(encuadreDeRectangulo(2000, 1000, { x: 0, y: 0, w: 2000, h: 1000 }).zoom).toBe(1);
    expect(encuadreDeRectangulo(2000, 1000, { x: 10, y: 10, w: 2, h: 2 }).zoom).toBe(ZOOM_MAX);
  });
  it("la ventana base es la mayor con la proporción del marco", () => {
    const b = ventanaBase(2000, 1000);
    expect(b.h).toBe(1000);
    expect(b.w / b.h).toBeCloseTo(PROPORCION_FOTO, 5);
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

describe("giro fino (progresivo)", () => {
  it("con giro fino la ventana siempre cae dentro de la imagen girada: sus cuatro esquinas están dentro del rectángulo original", () => {
    const W = 2000;
    const H = 1500;
    for (const angulo of [-40, -15, -3, 0.5, 7, 22, 45]) {
      for (const [cx, cy, zoom] of [[0.5, 0.5, 1], [0, 0, 3], [1, 1, 2], [0.2, 0.9, 6]] as const) {
        const e = { zoom, cx, cy, angulo };
        const v = ventanaDeRecorte(W, H, e);
        const l = lienzoRotado(W, H, angulo);
        expect(v.w / v.h).toBeCloseTo(PROPORCION_FOTO, 6);
        const rad = (angulo * Math.PI) / 180;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          // esquina del marco en el lienzo → coordenadas de la imagen sin girar
          const px = v.x + dx * v.w - l.ancho / 2;
          const py = v.y + dy * v.h - l.alto / 2;
          const qx = Math.cos(rad) * px + Math.sin(rad) * py;
          const qy = -Math.sin(rad) * px + Math.cos(rad) * py;
          expect(Math.abs(qx)).toBeLessThanOrEqual(W / 2 + 1e-6);
          expect(Math.abs(qy)).toBeLessThanOrEqual(H / 2 + 1e-6);
        }
      }
    }
  });
  it("sin giro fino todo da igual que antes y una edición con solo giro fino ya no es «nula»", () => {
    expect(ventanaDeRecorte(2000, 1000, { zoom: 2, cx: 0.5, cy: 0.5, angulo: 0 })).toEqual(ventanaDeRecorte(2000, 1000, { zoom: 2, cx: 0.5, cy: 0.5 }));
    expect(esEdicionNula(EDICION_INICIAL)).toBe(true);
    expect(esEdicionNula({ ...EDICION_INICIAL, angulo: 2 })).toBe(false);
    expect(edicionFotoSchema.safeParse({ ...EDICION_INICIAL, angulo: 46 }).success).toBe(false);
    expect(edicionFotoSchema.safeParse({ ...EDICION_INICIAL, angulo: -12.5 }).success).toBe(true);
  });
  it("el servidor aplica el giro fino y entrega la foto final del tamaño pedido, sin esquinas vacías", async () => {
    const sharp = (await import("sharp")).default;
    const { aplicarEdicion } = await import("../lib/fotos/aplicar");
    // imagen toda blanca: si entrara una esquina vacía (transparente → negra al pasar a JPEG), habría píxeles oscuros
    const blanca = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    for (const angulo of [-30, 12, 45]) {
      const out = await aplicarEdicion(blanca, { ...EDICION_INICIAL, angulo }, { ancho: 400, alto: 310 });
      const m = await sharp(out).metadata();
      expect([m.width, m.height]).toEqual([400, 310]);
      const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
      let oscuros = 0;
      for (let i = 0; i < data.length; i += 3) if (data[i] < 200) oscuros++;
      expect(oscuros / (data.length / 3)).toBeLessThan(0.002);
    }
  });
});
