import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import sharp from "sharp";
import { generarAnexo } from "../lib/docs/anexo";

const jpg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 120, b: 200 } } }).jpeg().toBuffer();
const base = { siniestro: "123", asegurado: "Ana", liquidacion: "9", anio: "2026" };

describe("anexo de fotografías", () => {
  it("normal: lleva portada, salto de página y una foto corrupta se omite avisando", async () => {
    const omitidas: string[] = [];
    const buf = await generarAnexo({
      ...base,
      fotos: [
        { id: "a", recinto: "Living", buffer: await jpg(900, 700) },
        { id: "b", recinto: "Living", buffer: Buffer.from("corrupta") },
      ],
      calidad: "150",
      alOmitirFoto: (f) => omitidas.push(f.id ?? ""),
    });
    const xml = new PizZip(buf).file("word/document.xml")!.asText();
    expect(xml).toContain("FOTOGRAFÍAS");
    expect(omitidas).toEqual(["b"]);
    expect((xml.match(/<wp:inline/g) ?? []).length).toBe(1);
  });
  it("compacto: sin portada y con márgenes 1,5 / 1,84 cm", async () => {
    const buf = await generarAnexo({ ...base, fotos: [{ id: "a", recinto: "Living", buffer: await jpg(900, 700) }], compacto: true });
    const xml = new PizZip(buf).file("word/document.xml")!.asText();
    expect(xml).not.toContain("FOTOGRAFÍAS");
    const mar = /<w:pgMar [^>]*>/.exec(xml)![0];
    expect(mar).toMatch(/w:top="850"/);
    expect(mar).toMatch(/w:bottom="850"/);
    expect(mar).toMatch(/w:left="1043"/);
    expect(mar).toMatch(/w:right="1043"/);
  });
});
