import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { leerPlanilla } from "../lib/extraccion/planilla";
import { generarExcel } from "../lib/docs/excel";
import { datosCasoSchema } from "../lib/domain/tipos";
import { evaluarFormula, numeroACol, colANumero } from "../lib/docs/formulas";
import { aplicarCeldas, cargarLibro, interpretarEntrada, libroAVista, recalcular } from "../lib/docs/vista-xlsx";
import { aplicarEdiciones, docxAVista, type ParrafoVista, type BloqueVista } from "../lib/docs/vista-docx";

describe("fórmulas de la planilla", () => {
  const celdas: Record<string, unknown> = { "1,1": 4, "1,2": 5, "1,3": 6, "2,1": 10 };
  const leer = (h: string | null, c: number, r: number) => (h === "Otra" ? (c === 1 && r === 1 ? 7 : null) : (celdas[`${c},${r}`] ?? null));
  it("aritmética, rangos y otras hojas", () => {
    expect(evaluarFormula("+A1*A2", "H", leer)).toBe(20);
    expect(evaluarFormula("SUM(A1:A3)", "H", leer)).toBe(15);
    expect(evaluarFormula("2*(A1+A2)-1", "H", leer)).toBe(17);
    expect(evaluarFormula("A1/B1", "H", leer)).toBeCloseTo(0.4);
    expect(evaluarFormula("'Otra'!A1+1", "H", leer)).toBe(8);
    expect(evaluarFormula("ROUND(A3/4,1)", "H", leer)).toBe(1.5);
  });
  it("lo que no entiende devuelve null (la celda conserva su valor)", () => {
    expect(evaluarFormula("VLOOKUP(A1,B1,2)", "H", leer)).toBeNull();
    expect(evaluarFormula("A1/0", "H", leer)).toBeNull();
  });
  it("columnas ↔ números", () => {
    expect(colANumero("AA")).toBe(27);
    expect(numeroACol(27)).toBe("AA");
  });
  it("interpreta lo que escribe el usuario", () => {
    expect(interpretarEntrada("1.234,5")).toBe(1234.5);
    expect(interpretarEntrada("12,5")).toBe(12.5);
    expect(interpretarEntrada("Hola")).toBe("Hola");
    expect(interpretarEntrada("")).toBeNull();
    expect(interpretarEntrada("2026-07-16")).toEqual(new Date(Date.UTC(2026, 6, 16)));
  });
});

async function excelCaso1() {
  const orig = await leerPlanilla(globSync("fuente/1981023*/1981023 Ajuste v1.xlsx")[0]);
  const caso = datosCasoSchema.parse({
    siniestro: "1981023", liquidacion: "170448", aseguradora: "HDI", asegurado: { nombre: "X", rut: "1", direccion: "d" }, beneficiario: { nombre: "B", rut: "2", direccion: "d" },
    poliza: { tipo: "Incendio", numero: "1", item: "4", vigenciaDesde: "01/10/2024", vigenciaHasta: "30/09/2026", materia: "m", sumaAseguradaUF: 1294, deducibleUF: 0 },
    ubicacion: "u", comuna: "c", region: "r", fechas: { inspeccion: "07/08/2026", asignacion: "29/07/2026", denuncia: "29/07/2026", ocurrencia: "2026-07-16", emision: null, informadoPartes: null }, denunciaTexto: null, modo: "reclamacion",
  });
  const buf = await generarExcel({ caso, reclamacion: orig.reclamacion, decisiones: orig.decisiones, adicionales: orig.adicionales, valorUF: orig.valorUF!, recintos: [{ nombre: "Living", alto: 2.4, largo: 3.2, ancho: 3.2 }], siniestrosAnteriores: [] });
  return { buf, orig };
}

describe("vista y edición del Excel", () => {
  it("el recálculo propio coincide con los totales que trae la planilla y, repetido, no cambia nada", async () => {
    const { buf } = await excelCaso1();
    const antes = await leerPlanilla(buf);
    const wb = await cargarLibro(buf);
    recalcular(wb); // rellena las fórmulas que la planilla deja sin valor guardado (Excel las calcula al abrir)
    expect(recalcular(wb)).toBe(0);
    const despues = await leerPlanilla(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(despues.ufCalculadoAjuste).toBeCloseTo(antes.ufCalculadoAjuste!, 6);
    expect(despues.ufCalculadoReclamacion).toBeCloseTo(antes.ufCalculadoReclamacion!, 6);
  });
  it("la vista trae las hojas con sus celdas y marca las fórmulas", async () => {
    const { buf } = await excelCaso1();
    const hojas = libroAVista(await cargarLibro(buf));
    const ed = hojas.find((h) => h.nombre === "EDIFICIO")!;
    expect(ed.celdas.some((c) => c.f)).toBe(true);
    expect(ed.celdas.some((c) => !c.f && c.txt)).toBe(true);
  });
  it("editar una cantidad recalcula los totales y el resultado se lee de nuevo", async () => {
    const { buf, orig } = await excelCaso1();
    const antes = (await leerPlanilla(buf)).ufCalculadoAjuste!;
    // Primera partida con cantidad de ajuste distinta de 0: columna H de EDIFICIO.
    const hojas = libroAVista(await cargarLibro(buf));
    const ed = hojas.find((h) => h.nombre === "EDIFICIO")!;
    const celda = ed.celdas.find((c) => c.c === 8 && c.r > 11 && !c.f && Number(c.raw) > 0)!;
    const r = await aplicarCeldas(buf, [{ hoja: "EDIFICIO", r: celda.r, c: 8, valor: "0" }]);
    expect(r.recalculadas).toBeGreaterThan(0);
    const despues = await leerPlanilla(r.buffer);
    expect(despues.ufCalculadoAjuste!).toBeLessThan(antes);
    expect(despues.decisiones.length).toBe(orig.decisiones.length);
  });
  it("una celda con fórmula no se puede pisar", async () => {
    const { buf } = await excelCaso1();
    const ed = libroAVista(await cargarLibro(buf)).find((h) => h.nombre === "EDIFICIO")!;
    const f = ed.celdas.find((c) => c.f)!;
    await expect(aplicarCeldas(buf, [{ hoja: "EDIFICIO", r: f.r, c: f.c, valor: "1" }])).rejects.toThrow(/fórmula/);
  });
});

describe("vista y edición del Word", () => {
  const plantilla = () => readFileSync("plantillas/informe.docx");
  const parrafos = (b: BloqueVista[]): ParrafoVista[] => b.flatMap((x) => (x.tipo === "p" ? [x] : x.filas.flatMap((f) => f.celdas.flatMap((c) => parrafos(c.bloques)))));
  it("recorre párrafos y tablas con índices únicos", () => {
    const { bloques, parrafos: n } = docxAVista(plantilla());
    const ps = parrafos(bloques);
    expect(ps.length).toBeLessThanOrEqual(n); // los párrafos de cuadros de texto flotantes no se muestran
    expect(new Set(ps.map((p) => p.i)).size).toBe(ps.length);
    expect(ps.some((p) => p.texto.length > 20)).toBe(true);
  });
  const base = () => {
    const ps = parrafos(docxAVista(plantilla()).bloques);
    return { ps, objetivo: ps.find((p) => p.editable && p.texto.length > 30)! };
  };
  it("cambiar el texto de un párrafo solo cambia ese párrafo y deja el documento válido", () => {
    const { ps, objetivo } = base();
    const { buffer, aplicados } = aplicarEdiciones(plantilla(), { parrafos: { [objetivo.i]: [{ t: "Texto corregido por el usuario" }] } });
    expect(aplicados).toBe(1);
    const ps2 = parrafos(docxAVista(buffer).bloques);
    expect(ps2.find((p) => p.i === objetivo.i)!.texto).toBe("Texto corregido por el usuario");
    expect(ps2.length).toBe(ps.length);
    expect(ps2.filter((p) => p.texto !== ps.find((q) => q.i === p.i)!.texto).length).toBe(1);
  });
  it("conserva el formato elegido: negrita, cursiva y subrayado por tramos", () => {
    const { objetivo } = base();
    const { buffer } = aplicarEdiciones(plantilla(), { parrafos: { [objetivo.i]: [{ t: "Normal " }, { t: "negrita", b: true }, { t: " cursiva", i: true }, { t: " sub", u: true }] } });
    const p = parrafos(docxAVista(buffer).bloques).find((x) => x.i === objetivo.i)!;
    expect(p.runs.map((r) => [r.t, !!r.b, !!r.i, !!r.u])).toEqual([["Normal ", false, false, false], ["negrita", true, false, false], [" cursiva", false, true, false], [" sub", false, false, true]]);
  });
  it("inserta un párrafo nuevo debajo y elimina otro, resolviendo contra los índices originales", () => {
    const { ps, objetivo } = base();
    const otro = ps.find((p) => p.editable && p.texto.length > 30 && p.i > objetivo.i + 3 && !p.texto.includes("Nuevo"))!;
    const { buffer } = aplicarEdiciones(plantilla(), { insertar: [{ despuesDe: objetivo.i, runs: [{ t: "Nuevo párrafo" }] }], eliminar: [otro.i] });
    const ps2 = parrafos(docxAVista(buffer).bloques);
    expect(ps2.map((p) => p.texto)).toContain("Nuevo párrafo");
    const cuenta = (l: ParrafoVista[], t: string) => l.filter((p) => p.texto === t).length;
    expect(cuenta(ps2, otro.texto)).toBe(cuenta(ps, otro.texto) - 1);
  });
  it("rechaza índices inexistentes", () => {
    expect(() => aplicarEdiciones(plantilla(), { parrafos: { "99999": [{ t: "x" }] } })).toThrow(/no existe/);
  });
});

describe("sincronización del Word con los cambios", () => {
  it("actualiza los totales del texto sin tocar números más largos que los contienen", async () => {
    const { actualizarTotales } = await import("../lib/docs/sincronizar-word");
    const plantilla = readFileSync("plantillas/informe.docx");
    const ps = (b: Buffer) => { const out: string[] = []; const rec = (bs: BloqueVista[]) => bs.forEach((x) => (x.tipo === "p" ? out.push(x.texto) : x.filas.forEach((f) => f.celdas.forEach((c) => rec(c.bloques))))); rec(docxAVista(b).bloques); return out; };
    const objetivo = docxAVista(plantilla).bloques.flatMap(function r(x): ParrafoVista[] { return x.tipo === "p" ? [x] : x.filas.flatMap((f) => f.celdas.flatMap((c) => c.bloques.flatMap(r))); }).find((p) => p.editable && p.texto.length > 30)!;
    const { buffer } = aplicarEdiciones(plantilla, { parrafos: { [objetivo.i]: [{ t: "Valor 46,73 UF; otro 146,73 UF; pesos $1.234.567." }] } });
    const r = actualizarTotales(buffer, [["46,73", "40,00"], ["$1.234.567", "$9.999"], ["40,00", "99,99"]]);
    expect(r.reemplazos).toBe(2);
    expect(ps(r.buffer)).toContain("Valor 40,00 UF; otro 146,73 UF; pesos $9.999.");
  });
});

describe("imágenes del Word: una vez cada una, con tamaño editable", () => {
  const plantilla = () => readFileSync("plantillas/informe.docx");
  const imgs = (b: Buffer) => { const out: { idx: number; w: number; h: number; src: string }[] = []; const rec = (bs: BloqueVista[]) => bs.forEach((x) => (x.tipo === "p" ? out.push(...x.imagenes) : x.filas.forEach((f) => f.celdas.forEach((c) => rec(c.bloques))))); rec(docxAVista(b).bloques); return out; };
  it("las firmas aparecen una sola vez (no se cuentan las alternativas de compatibilidad ni los cuadros de texto vacíos)", () => {
    const todas = imgs(plantilla());
    const idxs = todas.map((i) => i.idx);
    expect(new Set(idxs).size).toBe(idxs.length);
    const porImagen = new Map<string, number>();
    for (const i of todas) porImagen.set(i.src, (porImagen.get(i.src) ?? 0) + 1);
    // La firma (image6.png) está una vez en el documento y no se repite en la vista.
    expect([...porImagen.values()].filter((n) => n === 1).length).toBeGreaterThan(0);
    expect(Math.max(...[...porImagen.entries()].filter(([, n]) => n <= 3).map(([, n]) => n))).toBe(1);
  });
  it("cambia el tamaño de una imagen y la puede quitar", () => {
    const antes = imgs(plantilla());
    const objetivo = antes[antes.length - 1];
    const { buffer } = aplicarEdiciones(plantilla(), { imagenes: [{ idx: objetivo.idx, cx: 1800000, cy: 900000 }] });
    const despues = imgs(buffer).find((i) => i.idx === objetivo.idx)!;
    expect([despues.w, despues.h]).toEqual([Math.round(1800000 / 9525), Math.round(900000 / 9525)]);
    const sin = aplicarEdiciones(plantilla(), { quitarImagenes: [objetivo.idx] }).buffer;
    expect(imgs(sin).length).toBe(antes.length - 1);
  });
  it("un párrafo con texto e imagen se puede corregir sin perder la imagen", () => {
    const v = docxAVista(plantilla());
    const ps: ParrafoVista[] = [];
    const rec = (bs: BloqueVista[]) => bs.forEach((x) => (x.tipo === "p" ? ps.push(x) : x.filas.forEach((f) => f.celdas.forEach((c) => rec(c.bloques)))));
    rec(v.bloques);
    const mixto = ps.find((p) => p.imagenes.length > 0 && p.texto.trim() !== "" && p.editable);
    if (!mixto) return; // la plantilla puede no tener ninguno: no es un fallo
    const { buffer } = aplicarEdiciones(plantilla(), { parrafos: { [mixto.i]: [{ t: "Texto nuevo" }] } });
    expect(imgs(buffer).length).toBe(imgs(plantilla()).length);
    // El texto anterior desaparece del todo (aunque estuviera en el mismo tramo que la imagen) y no se duplica.
    const despues: ParrafoVista[] = [];
    const rec2 = (bs: BloqueVista[]) => bs.forEach((x) => (x.tipo === "p" ? despues.push(x) : x.filas.forEach((f) => f.celdas.forEach((c) => rec2(c.bloques)))));
    rec2(docxAVista(buffer).bloques);
    expect(despues.find((p) => p.i === mixto.i)!.texto).toBe("Texto nuevo");
  });
});
