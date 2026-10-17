import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { sugerirFotos, nitidez } from "../lib/fotos/sugerencias";

const degradado = (w: number, h: number, invertido = false) => {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) raw[(y * w + x) * 3 + c] = Math.round(((invertido ? w - x : x) / w) * 255);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
};
const tablero = (w: number, h: number, lado: number) => {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.fill(((Math.floor(x / lado) + Math.floor(y / lado)) % 2) * 255, (y * w + x) * 3, (y * w + x) * 3 + 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
};
const foto = (id: string, recinto: string, b: Promise<Buffer>) => ({ id, nombre: `${id}.jpg`, recinto, cargar: () => b });

describe("sugerencias de fotos", () => {
  it("una imagen con bordes nítidos supera a una plana en nitidez", async () => {
    expect(await nitidez(await tablero(400, 300, 20))).toBeGreaterThan(await nitidez(await degradado(400, 300)));
  });
  it("detecta duplicadas (aunque cambie el tamaño), borrosas, vista general y cantidad impar", async () => {
    const a = tablero(640, 480, 16);
    const s = await sugerirFotos([
      foto("a", "Living", a),
      foto("a2", "Living", tablero(320, 240, 8)), // la misma escena a otro tamaño
      foto("b", "Living", tablero(640, 480, 40)),
      foto("liso", "Living", degradado(640, 480, true)),
      foto("rota", "Cocina", Promise.resolve(Buffer.from("no es imagen"))),
    ]);
    const living = s.find((x) => x.recinto === "Living")!;
    expect(living.vistaGeneral).toBe("a.jpg");
    expect(living.duplicadas.map((d) => d.id)).toContain("a2");
    expect(living.borrosas.map((b) => b.id)).toContain("liso");
    expect(living.utiles % 2 === 1 ? living.avisos.length > 0 : true).toBe(true);
    const cocina = s.find((x) => x.recinto === "Cocina")!;
    expect(cocina.utiles).toBe(0);
  });
});
