import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import { expandirZip, rutaSegura, MAX_ENTRADAS_ZIP } from "../lib/caso/zip-entrada";

const zipCon = (archivos: Record<string, string | Buffer>) => {
  const z = new PizZip();
  for (const [n, c] of Object.entries(archivos)) z.file(n, c);
  return z.generate({ type: "nodebuffer", compression: "DEFLATE" });
};

describe("subida de ZIP", () => {
  it("rechaza rutas que escapan de la carpeta, absolutas y basura del sistema", () => {
    expect(rutaSegura("../fuera.pdf")).toBeNull();
    expect(rutaSegura("a/../../b.pdf")).toBeNull();
    expect(rutaSegura("/etc/passwd")).toBeNull();
    expect(rutaSegura("C:/x/y.pdf")).toBeNull();
    expect(rutaSegura("__MACOSX/a.jpg")).toBeNull();
    expect(rutaSegura(".oculto/a.jpg")).toBeNull();
    expect(rutaSegura("Living/Thumbs.db")).toBeNull();
    expect(rutaSegura(["Living", "1.jpg"].join(String.fromCharCode(92)))).toBe("Living/1.jpg");
    expect(rutaSegura("Dormitorio 1/2.jpg")).toBe("Dormitorio 1/2.jpg");
  });

  it("conserva las carpetas como ruta y omite lo no admitido con su motivo", () => {
    const r = expandirZip(zipCon({ "Living/1.jpg": "x", "Living/2.png": "y", "acta.pdf": "p", "notas.exe": "e", "../escape.pdf": "z", "__MACOSX/._1.jpg": "m" }));
    expect(r.entradas.map((e) => e.ruta).sort()).toEqual(["Living/1.jpg", "Living/2.png", "acta.pdf"]);
    expect(r.entradas.find((e) => e.ruta === "Living/1.jpg")!.nombre).toBe("1.jpg");
    expect(r.omitidos.map((o) => o.motivo).sort()).toEqual(["ruta no permitida", "ruta no permitida", "tipo no admitido"]);
  });

  it("rechaza un ZIP con demasiadas entradas y uno que no es ZIP", () => {
    const muchos: Record<string, string> = {};
    for (let i = 0; i <= MAX_ENTRADAS_ZIP; i++) muchos[`f${i}.jpg`] = "x";
    expect(() => expandirZip(zipCon(muchos))).toThrow(/máximo/);
    expect(() => expandirZip(Buffer.from("esto no es un zip"))).toThrow();
  });
});
