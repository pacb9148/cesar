import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { leerPlanilla } from "../lib/extraccion/planilla";
import { generarExcel } from "../lib/docs/excel";
import { datosCasoSchema } from "../lib/domain/tipos";
import { evaluarFormula, numeroACol, colANumero } from "../lib/docs/formulas";
import { aplicarCeldas, cargarLibro, interpretarEntrada, libroAVista, recalcular } from "../lib/docs/vista-xlsx";
import { aplicarTextos, docxAVista, type ParrafoVista, type BloqueVista } from "../lib/docs/vista-docx";

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
  it("cambiar el texto de un párrafo solo cambia ese párrafo y deja el documento válido", () => {
    const v = docxAVista(plantilla());
    const ps = parrafos(v.bloques);
    const objetivo = ps.find((p) => p.editable && p.texto.length > 30)!;
    const { buffer, aplicados } = aplicarTextos(plantilla(), { [objetivo.i]: "Texto corregido por el usuario" });
    expect(aplicados).toBe(1);
    const v2 = docxAVista(buffer);
    const ps2 = parrafos(v2.bloques);
    expect(ps2.find((p) => p.i === objetivo.i)!.texto).toBe("Texto corregido por el usuario");
    expect(ps2.length).toBe(ps.length);
    expect(ps2.filter((p) => p.texto !== ps.find((q) => q.i === p.i)!.texto).length).toBe(1);
  });
  it("rechaza índices inexistentes", () => {
    expect(() => aplicarTextos(plantilla(), { "99999": "x" })).toThrow(/no existe/);
  });
});
