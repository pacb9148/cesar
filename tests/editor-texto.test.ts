import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import PizZip from "pizzip";
import { aplicarEdiciones, docxAVista } from "../lib/docs/vista-docx";

const plantilla = () => readFileSync("plantillas/informe.docx");
const indiceDe = (buf: Buffer, re: RegExp) => {
  const v = docxAVista(buf);
  const buscar = (bs: ReturnType<typeof docxAVista>["bloques"]): number | null => {
    for (const b of bs) {
      if (b.tipo === "p" && b.editable && re.test(b.texto)) return b.i;
      if (b.tipo === "tabla") for (const f of b.filas) for (const c of f.celdas) { const r = buscar(c.bloques); if (r !== null) return r; }
    }
    return null;
  };
  return buscar(v.bloques)!;
};

describe("editor del informe: fuente, tamaño, color y alineación", () => {
  it("aplica fuente, tamaño y color al texto editado, con las propiedades en el orden que exige Word", () => {
    const buf = plantilla();
    const i = indiceDe(buf, /Evidencia observada|Causa origen|Relación de hechos/);
    const r = aplicarEdiciones(buf, { parrafos: { [String(i)]: [{ t: "Texto nuevo", b: true, font: "Arial", sz: 14, color: "ff0000" }] } });
    const xml = new PizZip(r.buffer).file("word/document.xml")!.asText();
    const run = /<w:r><w:rPr>((?:(?!<[/]w:rPr>)[^])*)<[/]w:rPr><w:t xml:space="preserve">Texto nuevo<[/]w:t><[/]w:r>/.exec(xml)![1];
    expect(run).toContain('<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>');
    expect(run).toContain('<w:sz w:val="28"/>');
    expect(run).toContain('<w:color w:val="FF0000"/>');
    // orden del esquema: rFonts, b, color, sz
    const orden = ["w:rFonts", "<w:b/>", "w:color", "w:sz "].map((x) => run.indexOf(x));
    expect(orden.every((v) => v >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("alinea un párrafo existente a la derecha, al centro o justificado", () => {
    const buf = plantilla();
    const i = indiceDe(buf, /Evidencia observada|Causa origen|Relación de hechos/);
    for (const jc of ["right", "center", "both", "left"] as const) {
      const r = aplicarEdiciones(buf, { alinear: { [String(i)]: jc } });
      const v = docxAVista(r.buffer);
      const p = JSON.stringify(v.bloques.find((b) => b.tipo === "p" && b.i === i) ?? v.bloques.flatMap((b) => (b.tipo === "tabla" ? b.filas.flatMap((f) => f.celdas.flatMap((c) => c.bloques)) : [])).find((b) => b.tipo === "p" && b.i === i));
      expect(p).toContain(jc === "both" ? "justify" : jc === "left" ? "\"i\":" + i : jc);
    }
  });

  it("rechaza una fuente o una alineación inventadas", () => {
    const buf = plantilla();
    const i = indiceDe(buf, /Evidencia observada|Causa origen|Relación de hechos/);
    expect(() => aplicarEdiciones(buf, { alinear: { [String(i)]: "diagonal" as never } })).toThrow(/Alineación/);
    const r = aplicarEdiciones(buf, { parrafos: { [String(i)]: [{ t: "x", font: "Arial<script>", sz: 9999, color: "zzzzzz" }] } });
    const xml = new PizZip(r.buffer).file("word/document.xml")!.asText();
    expect(xml).not.toContain("Arial<script>");
    expect(xml).not.toContain('w:val="19998"');
  });
});
