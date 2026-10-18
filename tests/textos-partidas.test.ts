import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import PizZip from "pizzip";
import { partidasDeEvidencia } from "../lib/caso/partidas-evidencia";
import { evidenciaDeTexto, textoDeEvidencia, textosDelInforme } from "../lib/caso/textos-informe";
import { reemplazarTextosDatos } from "../lib/docs/sincronizar-word";
import { docxAVista } from "../lib/docs/vista-docx";
import { parsearActa } from "../lib/extraccion/acta";
import { textoPdf } from "../lib/extraccion/pdf";
import { salidaBase } from "../lib/caso/ajuste-base";
import { armarFilas } from "../lib/engine/filas";
import { auditarAjuste, reparosDeOrigenPrecio } from "../lib/engine/auditoria";

const ACTA = "fuente/1984853-172363-Francisco Andres Olea Yeomans-Banco Estado/TEXTO/INSP.-13124.pdf";
const acta = async () => parsearActa(await textoPdf(readFileSync(ACTA)));

describe("partidas de liquidación desde la evidencia (sin presupuesto)", () => {
  it("cada daño de cielo y muro da preparación, empaste y pintura a precio de la hoja Datos, con la cantidad del acta", async () => {
    const a = await acta();
    const { partidas, sinPartida } = partidasDeEvidencia(a);
    expect(sinPartida).toEqual([]);
    const d3 = partidas.filter((p) => p.seccion === "DORMITORIO 3"); // «Daños en paredes por agua», 6 m²
    expect(d3.map((p) => [p.descripcion, p.cantidad, p.pu])).toEqual([
      ["Preparación de Superficie Muros", 6, 2160],
      ["Empaste y Lijado Muros", 6, 4680],
      ["Aplicación de Pintura en Muros", 6, 8400],
    ]);
    // un daño que toca cielo y muros reparte su cantidad según la cubicación, sin perder metros
    const d1 = partidas.filter((p) => p.seccion === "DORMITORIO 1");
    expect(d1).toHaveLength(6);
    const porElemento = (tipo: RegExp) => d1.find((p) => tipo.test(p.descripcion))!.cantidad;
    expect(porElemento(/Cielo/) + porElemento(/Muros/)).toBeCloseTo(6, 1);
    expect(partidas.every((p) => p.pu_origen.startsWith("baremo:") && p.obs.length > 0)).toBe(true);
    expect(reparosDeOrigenPrecio([], partidas)).toEqual([]);
  });
  it("la plantilla base sin presupuesto trae las partidas, cumple las reglas y un daño sin partida automática se avisa", async () => {
    const a = await acta();
    const s = salidaBase(a, { conPartidas: true });
    expect(s.lineas_adicionales.length).toBeGreaterThan(10);
    const filas = armarFilas({ caso: { modo: "perdida_determinada" }, reclamacion: { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 }, decisiones: [], adicionales: s.lineas_adicionales });
    expect(auditarAjuste(filas, { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 }).cumple).toBe(true);
    expect(salidaBase(a).lineas_adicionales).toEqual([]);
    const raro = partidasDeEvidencia({ danos: [{ recinto: "Cubierta", alto: 0, ancho: 0, largo: 0, descripcion: "Levantamiento de planchas", tipoDano: "Roto", um: "m2", cantidad: 4 }] });
    expect(raro.partidas).toEqual([]);
    expect(raro.sinPartida[0]).toMatch(/Cubierta/);
  });
});

describe("textos del informe editables", () => {
  it("las líneas «Recinto: texto» van y vuelven, y lo editado manda sobre lo automático", async () => {
    const a = await acta();
    const auto = textosDelInforme({}, a, salidaBase(a));
    expect(auto.caracteristicas).toMatch(/^Vivienda de 2 pisos/);
    expect(textoDeEvidencia(auto.evidencia).split("\n")[0]).toBe("Dormitorio 1: Muro y cielo afectado por humedad.");
    const ev = evidenciaDeTexto("Dormitorio 1: Cielo con mancha\nSolo una nota sin recinto\n\n");
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ recinto: "Dormitorio 1", vineta: "Cielo con mancha" });
    expect(ev[1]).toMatchObject({ recinto: "", vineta: "Solo una nota sin recinto" });
    const propio = textosDelInforme({ textos: { caracteristicas: "Texto propio.", evidencia: "Baño: humedad en muro" } }, a, salidaBase(a));
    expect(propio.caracteristicas).toBe("Texto propio.");
    expect(propio.evidencia.map((e) => e.recinto)).toEqual(["Baño"]);
  });
  it("«Guardar e insertar» cambia solo el párrafo de características y la lista de evidencia del informe", () => {
    const buf = readFileSync("plantillas/informe.docx");
    const r = reemplazarTextosDatos(buf, { caracteristicas: "Casa de 2 pisos con 3 dormitorios.", evidencia: evidenciaDeTexto("Dormitorio 1: Cielo y muro afectado por humedad.\nLiving: Muro afectado por humedad.") });
    expect(r.caracteristicas && r.evidencia).toBe(true);
    const xml = new PizZip(r.buffer).file("word/document.xml")!.asText();
    expect(xml).toContain("Casa de 2 pisos con 3 dormitorios.");
    expect(xml).not.toContain(">xxxxx<");
    expect(xml).toContain("Cielo y muro afectado por humedad.");
    expect(xml).toContain("Las siguientes imágenes dan cuenta");
    // dos viñetas con la numeración de tilde de la plantilla
    expect((xml.match(/<w:numId w:val="1"\/>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("vista del informe sin aspecto de tabla", () => {
  it("las tablas de maquetación no traen bordes y los bordes reales (cuadro, subrayado de títulos) sí", () => {
    const v = docxAVista(readFileSync("plantillas/informe.docx"));
    const tablas = v.bloques.filter((b) => b.tipo === "tabla");
    expect(tablas.length).toBeGreaterThan(3);
    const banner = tablas.find((t) => t.tipo === "tabla" && JSON.stringify(t).includes("ANTECEDENTES"))!;
    expect(banner.tipo === "tabla" && banner.filas.every((f) => f.celdas.every((c) => !c.bordes?.l && !c.bordes?.r))).toBe(true);
  });
});

describe("viñetas de evidencia", () => {
  it("concuerdan en género con un elemento femenino", async () => {
    const { vinetaDeDano } = await import("../lib/caso/parrafo-inmueble");
    expect(vinetaDeDano({ descripcion: "Cubierta", tipoDano: "Roto" })).toBe("Cubierta rota.");
    expect(vinetaDeDano({ descripcion: "Daños en cielo y paredes por agua", tipoDano: "Afectado por agua" })).toBe("Cielo y muro afectado por humedad.");
  });
});

describe("formato del ajuste según los ajustes de referencia", () => {
  const reclVacia = { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 };
  it("una estancia nueva se arma estancia → elemento → partidas (1.0 / 1.1 Cielo / 1.1.1)", async () => {
    const a = await acta();
    const s = salidaBase(a, { conPartidas: true });
    const filas = armarFilas({ caso: { modo: "perdida_determinada" }, reclamacion: reclVacia, decisiones: [], adicionales: s.lineas_adicionales });
    const d1 = filas.slice(filas.findIndex((f) => f.tipo === "seccion" && f.titulo === "DORMITORIO 1"));
    expect(d1[0]).toMatchObject({ tipo: "seccion", item: "1.0", titulo: "DORMITORIO 1" });
    expect(d1[1]).toMatchObject({ tipo: "seccion", item: "1.1", titulo: "Muro", nivel: 2 });
    expect(d1[2]).toMatchObject({ tipo: "linea", item: "1.1.1" });
  });
  it("con presupuesto solo se agregan las estancias de la evidencia que el presupuesto no trae", async () => {
    const a = await acta();
    const recl = { ...reclVacia, secciones: [{ numero: "1.0", titulo: "DORMITORIO 1" }, { numero: "2.0", titulo: "LIVING" }] };
    const s = salidaBase(a, { reclamacion: recl });
    const estancias = new Set(s.lineas_adicionales.map((p) => p.seccion));
    expect(estancias.has("DORMITORIO 1")).toBe(false);
    expect(estancias.has("LIVING COMEDOR")).toBe(false); // «Living» del presupuesto ya cubre «Living Comedor»
    expect(estancias.has("DORMITORIO 2")).toBe(true);
    expect(estancias.has("CAJA ESCALA")).toBe(true);
  });
});
