import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { conResolucion } from "../lib/fotos/png-resolucion";

describe("resolución del PNG copiado", () => {
  it("anota la resolución física para que al pegar la imagen mida lo que se quería", async () => {
    const png = await sharp({ create: { width: 1024, height: 792, channels: 3, background: "#888" } }).png().toBuffer();
    // 1024 px en 8,66 cm → 11.824 px por metro.
    const con = Buffer.from(await (await conResolucion(new Blob([new Uint8Array(png)]), 1024 / 0.0866)).arrayBuffer());
    const meta = await sharp(con).metadata(); // sharp valida el CRC de cada bloque al decodificar
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(792);
    expect(meta.density).toBe(300); // sharp redondea los ppp
    expect((meta.width! / meta.density!) * 2.54).toBeCloseTo(8.66, 1);
    await expect(sharp(con).raw().toBuffer()).resolves.toBeTruthy(); // la imagen sigue decodificándose entera
  });
});
