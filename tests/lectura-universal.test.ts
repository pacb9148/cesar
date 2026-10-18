import { describe, it, expect } from "vitest";
import sharp from "sharp";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import type { ClienteLlm } from "../lib/ia/gemini";
import { leerInspeccion, leerPresupuesto } from "../lib/caso/leer-documentos";
import { parrafoInmueble, vinetaDeDano, modernizarEvidencia } from "../lib/caso/parrafo-inmueble";
import { formatoDe } from "../lib/extraccion/universal";
import { parsearActa } from "../lib/extraccion/acta";
import { textoPdf } from "../lib/extraccion/pdf";

const ACTA_PDF = "fuente/1984853-172363-Francisco Andres Olea Yeomans-Banco Estado/TEXTO/INSP.-13124.pdf";

/** Cliente simulado: responde siempre con el JSON dado y recuerda qué partes recibió. */
const falso = (respuesta: unknown) => {
  const llamadas: { partes: unknown[] }[] = [];
  const cliente: ClienteLlm = {
    async generarJson(o) {
      llamadas.push({ partes: o.partes });
      return { texto: JSON.stringify(respuesta), modelo: "falso" };
    },
  };
  return { cliente, llamadas };
};
const sinIa = () => {
  throw new Error("no debía usar IA");
};

describe("párrafo del inmueble y evidencia desde la inspección", () => {
  it("la inspección real da el párrafo y las viñetas esperadas", async () => {
    const a = parsearActa(await textoPdf(readFileSync(ACTA_PDF)));
    expect(a.tipoInmueble).toBe("Casa");
    const p = parrafoInmueble(a);
    expect(p).toContain("Vivienda de 2 pisos de uso exclusivo habitacional con una superficie construida de 90 m² y una antigüedad de 7 años. Consta de 3 dormitorios, 2 baños, cocina, living comedor, entre otras dependencias.");
    expect(p).toContain("Edificación de madera, techumbre soportada por cerchas de madera, cubierta de planchas de zinc alum, revestimientos en muros y cielo con pinturas y pavimentos de losa de hormigón armado.");
    expect(p).toContain("\n\n"); // dos párrafos separados por una línea en blanco
    expect(vinetaDeDano(a.danos[1])).toBe("Cielo y muro afectado por humedad.");
    expect(vinetaDeDano(a.danos[2])).toBe("Muro afectado por humedad.");
  });
  it("solo dice lo que consta y no toca viñetas escritas por una persona", () => {
    expect(parrafoInmueble({ pisos: 1 } as never)).toContain("Vivienda de 1 piso de uso exclusivo habitacional con una superficie construida de [FALTA DATO");
    expect(parrafoInmueble({} as never)).toBe("");
    const out = modernizarEvidencia(
      [
        { recinto: "Living", vineta: "Living: 8 m² con daño de tipo Afectado por agua registrado en el acta de inspección." },
        { recinto: "Baño", vineta: "Humedad por filtración propia." },
      ],
      [{ recinto: "Living", alto: 2, ancho: 3, largo: 3, descripcion: "Daños en cielo y paredes por agua", tipoDano: "Afectado por agua", um: "m2", cantidad: 8 }],
    );
    expect(out[0].vineta).toBe("Cielo y muro afectado por humedad.");
    expect(out[1].vineta).toBe("Humedad por filtración propia.");
  });
});

describe("lectura de documentos en cualquier formato", () => {
  it("reconoce el formato por nombre o tipo", () => {
    expect(formatoDe("a.PDF")).toBe("pdf");
    expect(formatoDe("a.docx")).toBe("docx");
    expect(formatoDe("a.xls")).toBe("xlsx");
    expect(formatoDe("foto.JPG")).toBe("imagen");
    expect(formatoDe("x.bin", "text/plain")).toBe("texto");
  });
  it("la inspección en PDF con el formato conocido se lee sin IA", async () => {
    const alertas: string[] = [];
    const a = await leerInspeccion([{ nombre: "insp.pdf", mime: "application/pdf", contenido: readFileSync(ACTA_PDF) }], sinIa, alertas);
    expect(a?.danos).toHaveLength(6);
    expect(alertas).toEqual([]);
  });
  it("una inspección en imagen se lee con IA enviando la imagen", async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#fff" } }).png().toBuffer();
    const { cliente, llamadas } = falso({
      siniestro: "123", caso: null, compania: null, asegurado: "Ana", rut: null, direccionRiesgo: null, comuna: null, region: null, fechaSiniestro: "16-07-2026", fechaInspeccion: null, inspector: null,
      hechos: "Temporal", causa: "Temporal viento y lluvia", tipoInmueble: "Casa", pisos: 2, dormitorios: 3, banos: 2, superficieM2: 90, antiguedad: 7, sistemaEstructural: null, estructuraTechumbre: null, cubierta: null, pavimentos: null,
      danosEdificio: true, danosContenido: false, danos: [{ recinto: "Living", alto: 2.4, ancho: 3, largo: 3, descripcion: "Daños en cielo por agua", tipoDano: "Afectado por agua", um: "m2", cantidad: 8 }],
    });
    const alertas: string[] = [];
    const a = await leerInspeccion([{ nombre: "foto-inspeccion.png", mime: "image/png", contenido: png }], () => cliente, alertas);
    expect(a?.siniestro).toBe("123");
    expect(a?.danos[0].recinto).toBe("Living");
    expect(JSON.stringify(llamadas[0].partes)).toContain("image/png");
  });
  it("un presupuesto Excel con columnas conocidas se lee sin IA y mantiene el orden", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("P");
    ws.addRow(["Ítem", "Descripción", "U/M", "Cant.", "P. Unit.", "Total"]);
    ws.addRow(["", "DORMITORIO 1"]);
    ws.addRow([1, "Pintura cielo", "m2", 9.5, 5500, 52250]);
    ws.addRow([2, "Pintura muros", "m2", 20, 4500, 90000]);
    const alertas: string[] = [];
    const r = await leerPresupuesto([{ nombre: "p.xlsx", mime: "", contenido: Buffer.from(await wb.xlsx.writeBuffer()) }], sinIa, alertas);
    expect(r?.reclamacion.lineas.map((l) => l.descripcion)).toEqual(["Pintura cielo", "Pintura muros"]);
  });
  it("un presupuesto en imagen se transcribe con IA conservando el orden y avisa que hay que revisarlo", async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#fff" } }).png().toBuffer();
    const { cliente } = falso({
      secciones: [
        { titulo: "COCINA", partidas: [{ descripcion: "Pintura cielo", um: "m2", cantidad: 6, pu: 5500 }] },
        { titulo: "BAÑO", partidas: [{ descripcion: "Sello", um: "ml", cantidad: 3, pu: 2000 }] },
      ],
      costoDirecto: null, gastosGenerales: null, utilidad: null, iva: null,
    });
    const alertas: string[] = [];
    const r = await leerPresupuesto([{ nombre: "presupuesto.png", mime: "image/png", contenido: png }], () => cliente, alertas);
    expect(r?.reclamacion.secciones.map((s) => s.titulo)).toEqual(["COCINA", "BAÑO"]);
    expect(r?.reclamacion.lineas.map((l) => l.item)).toEqual(["1.1", "2.1"]);
    expect(r?.alertas[0]).toMatch(/revisa las partidas/);
  });
  it("sin IA disponible, una imagen deja una alerta clara y no inventa nada", async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#fff" } }).png().toBuffer();
    const alertas: string[] = [];
    const r = await leerPresupuesto([{ nombre: "p.png", mime: "image/png", contenido: png }], () => { throw new Error("No hay ningún proveedor de IA activo"); }, alertas);
    expect(r).toBeNull();
    expect(alertas[0]).toMatch(/proveedor de IA/);
  });
});
