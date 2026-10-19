import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { generarExcel } from "../lib/docs/excel";
import { datosCasoSchema, type LineaAdicional } from "../lib/domain/tipos";
import { armarFilas } from "../lib/engine/filas";
import { calcularTotales } from "../lib/engine/totales";
import { insertarDespuesDelRecinto, obsPorDefecto, partidaNueva, umDe } from "../lib/caso/asociadas";
import { aplicablesDe, buscarPartidas, complementosDe, etiquetasDe, MAX_SUGERENCIAS } from "../lib/caso/relacion-partidas";
import { BAREMO } from "../lib/engine/baremo";

const lin = (seccion: string, descripcion = "x", extra: Partial<LineaAdicional> = {}): LineaAdicional => ({ seccion, elemento: "Cielo", descripcion, um: "m2", cantidad: 2, pu: 1000, pu_origen: "mercado:manual", obs: ["B"], justificacion: "", ...extra });

describe("insertar partida en el ajuste", () => {
  it("la inserta a continuación de la última partida de su recinto y deja lo demás en su sitio", () => {
    const base = [lin("LIVING", "a"), lin("COCINA", "b"), lin("LIVING", "c"), lin("BAÑO", "d")];
    const r = insertarDespuesDelRecinto(base, [lin("living", "nueva1"), lin("LIVING", "nueva2")]);
    expect(r.map((x) => x.descripcion)).toEqual(["a", "b", "c", "nueva1", "nueva2", "d"]);
    // Recinto sin partidas: al final; recinto contenido en otro («Dormitorio» en «Dormitorio 1»): tras la última de esa estancia.
    expect(insertarDespuesDelRecinto(base, [lin("QUINCHO", "q")]).at(-1)?.descripcion).toBe("q");
    expect(insertarDespuesDelRecinto([lin("DORMITORIO 1", "m")], [lin("DORMITORIO", "n")]).map((x) => x.descripcion)).toEqual(["m", "n"]);
  });

  it("las partidas insertadas suman en los totales del ajuste", () => {
    const entrada = { caso: { modo: "perdida_determinada" as const }, reclamacion: { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 }, decisiones: [] };
    const antes = armarFilas({ ...entrada, adicionales: [lin("LIVING", "a")] });
    const nuevas = [partidaNueva({ recinto: "living", elemento: "Cielo", descripcion: "Pintura", um: "m2", cantidad: 3, pu: 500, obs: ["B"] })];
    const despues = armarFilas({ ...entrada, adicionales: insertarDespuesDelRecinto([lin("LIVING", "a")], nuevas) });
    const suma = (f: typeof antes) => f.reduce((s, x) => (x.tipo === "linea" && x.aj ? s + x.aj.cantidad * x.aj.pu : s), 0);
    expect(suma(antes)).toBe(2000);
    expect(suma(despues)).toBe(3500);
    const t = calcularTotales(despues.flatMap((x) => (x.tipo === "linea" && x.aj ? [{ cantidad: x.aj.cantidad, pu: x.aj.pu }] : [])), { ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19, valorUF: 40000 });
    expect(t.directo).toBe(3500);
  });

  it("la U/M sale de lo aprendido o de la descripción", () => {
    expect(umDe(2)).toBe("m2"); // Preparación de superficie cielo
    const guardapolvo = BAREMO.find((b) => /guardapolvo/i.test(b.descripcion))!;
    expect(umDe(guardapolvo.id)).toBe("ml");
    const puerta = BAREMO.find((b) => /^Retiro de puerta/i.test(b.descripcion))!;
    expect(umDe(puerta.id)).toBe("un");
    expect(obsPorDefecto("m2")).toEqual(["B", "C"]);
    expect(obsPorDefecto("un")).toEqual(["B"]);
  });
});

describe("sugerencias de partidas", () => {
  const nombres = (l: { descripcion: string }[]) => l.map((x) => x.descripcion.toLowerCase());

  it("entiende qué hace una partida y sobre qué", () => {
    expect(etiquetasDe("Retiro cielo yeso cartón")).toMatchObject({ accion: "retiro" });
    expect([...etiquetasDe("Retiro cielo yeso cartón").objetos]).toEqual(["cielo"]);
    expect(etiquetasDe("Pintura y Sellos Cornisas.").accion).toBe("pintura");
    expect([...etiquetasDe("Reposición volcanita yeso cartón").objetos].sort()).toEqual(["cielo", "muro"]);
  });

  it("un cielo con humedad: la partida aplicable es retirar el yeso cartón, y son como máximo 5 trabajos distintos", () => {
    const l = aplicablesDe({ elemento: "Cielo", dano: "Escurrimiento de agua y humedad en el cielo del baño" });
    expect(l.length).toBeLessThanOrEqual(MAX_SUGERENCIAS);
    expect(nombres(l)[0]).toMatch(/retiro cielo.*yeso cart/);
    expect(new Set(l.map((x) => etiquetasDe(x.descripcion).accion)).size).toBe(l.length);
    expect(aplicablesDe({ elemento: "" })).toEqual([]);
  });

  it("«retiro de yeso cartón» trae empaste y lijado, pintura, reposición y la cornisa (retiro y reposición) como complementos", () => {
    const id = BAREMO.find((b) => /^Retiro cielo yeso cart/i.test(b.descripcion))!.id;
    const l = complementosDe(id, { elemento: "Cielo" });
    expect(l.length).toBeLessThanOrEqual(MAX_SUGERENCIAS);
    const t = nombres(l).join(" | ");
    expect(t).toMatch(/empaste/);
    expect(t).toMatch(/pintura/);
    expect(t).toMatch(/reposici[oó]n (volcanita|cielo)/);
    expect(t).toMatch(/retiro cornisa/);
    expect(t).toMatch(/reposici[oó]n cornisa/);
    expect(l.some((x) => x.id === id)).toBe(false);
    // Sin trabajos repetidos y sin ruido de otros elementos (papel mural, cierres…).
    expect(new Set(nombres(l)).size).toBe(l.length);
    expect(t).not.toMatch(/papel mural|pandereta|flexit/);
  });

  it("la preparación de un cielo trae el resto de su conjunto de reparación", () => {
    const ids = complementosDe(2, { elemento: "Cielo" }).map((a) => a.id);
    expect(ids).toContain(3);
    expect(ids).toContain(37);
  });

  it("la búsqueda libre encuentra cualquier partida de la hoja Datos por partes de palabras", () => {
    expect(nombres(buscarPartidas("cornisa repo")).join(" ")).toMatch(/reposici[oó]n cornisa/);
    expect(buscarPartidas("zzzz")).toEqual([]);
    expect(buscarPartidas("a")).toEqual([]);
  });
});

const caso = (modo: "reclamacion" | "perdida_determinada") =>
  datosCasoSchema.parse({
    siniestro: "1984853", liquidacion: "172363", aseguradora: "HDI Seguros S.A",
    asegurado: { nombre: "Francisco Olea", rut: "1-9", direccion: "Trumao 2289" },
    beneficiario: { nombre: "Banco", rut: "97", direccion: "Santiago" },
    poliza: { tipo: "Incendio", numero: "1", item: "4", vigenciaDesde: "01/10/2024", vigenciaHasta: "30/09/2026", materia: "Edificio", sumaAseguradaUF: 2023, deducibleUF: 0.5 },
    ubicacion: "Osorno", comuna: "Osorno", region: "Los Lagos",
    fechas: { inspeccion: "07/08/2026", asignacion: "29/07/2026", denuncia: "29/07/2026", ocurrencia: "2026-07-16", emision: "24/08/2026", informadoPartes: null },
    denunciaTexto: null, modo,
  });

/** Calcula una fórmula de las que escribe el generador (SUM de un rango y sumas, productos y cocientes de celdas) leyendo las demás celdas del libro. */
function evaluar(ws: ExcelJS.Worksheet, dir: string, memo = new Map<string, number>()): number {
  if (memo.has(dir)) return memo.get(dir)!;
  const v = ws.getCell(dir).value as unknown;
  let n = 0;
  if (typeof v === "number") n = v;
  else if (v && typeof v === "object" && "formula" in v) {
    const formula = String((v as { formula: string }).formula);
    const suma = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/.exec(formula);
    if (suma) for (let r = Number(suma[2]); r <= Number(suma[4]); r++) n += evaluar(ws, `${suma[1]}${r}`, memo);
    else n = Number(new Function(`return (${formula.replace(/[A-Z]+\d+/g, (c) => String(evaluar(ws, c, memo)))})`)());
  }
  memo.set(dir, n);
  return n;
}

describe("el Excel del ajuste lleva las fórmulas calculadas", () => {
  for (const modo of ["perdida_determinada", "reclamacion"] as const) {
    it(`modo ${modo}: cada fórmula da el valor guardado y el total directo suma las partidas, incluida la insertada`, async () => {
      const adicionales = insertarDespuesDelRecinto(
        [lin("LIVING", "Preparación de Superficie Cielo", { cantidad: 22.5, pu: 2160 }), lin("LIVING", "Aplicación Pintura Cielo", { cantidad: 22.5, pu: 8400 }), lin("COCINA", "Empaste", { cantidad: 5.29, pu: 4680 })],
        [partidaNueva({ recinto: "living", elemento: "Cielo", descripcion: "Guardapolvo", um: "ml", cantidad: 7, pu: 3100, obs: ["B"] })],
      );
      const buf = await generarExcel({ caso: caso(modo), reclamacion: { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 }, decisiones: [], adicionales, valorUF: 40844.79, recintos: [], siniestrosAnteriores: [] });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as never);
      const ws = wb.getWorksheet("EDIFICIO")!;
      const col = modo === "reclamacion" ? "J" : "F";
      let formulas = 0;
      const memo = new Map<string, number>();
      ws.eachRow((fila) =>
        fila.eachCell((c) => {
          const v = c.value as unknown;
          if (!v || typeof v !== "object" || !("formula" in v)) return;
          const guardado = (v as { result?: unknown }).result;
          if (typeof guardado !== "number") return; // p. ej. la fecha de pérdida
          formulas++;
          expect(evaluar(ws, c.address, memo), `${c.address} = ${(v as { formula: string }).formula}`).toBeCloseTo(guardado, 2);
        }),
      );
      expect(formulas).toBeGreaterThanOrEqual(4 + 7); // 4 partidas con su total y los totales (directo, GG, neto, IVA, total con IVA, UF, valor a indemnizar)
      // Total directo = suma de los totales de las partidas (22,5×2160 + 22,5×8400 + 5,29×4680 + 7×3100).
      const filaTotal = [...Array(200).keys()].map((i) => i + 12).find((r) => String(ws.getCell(r, 2).value).startsWith("Total directo"))!;
      const esperado = 22.5 * 2160 + 22.5 * 8400 + 5.29 * 4680 + 7 * 3100;
      expect(evaluar(ws, `${col}${filaTotal}`, memo)).toBeCloseTo(esperado, 2);
      const cuerpo = (ws.getCell(`${col}${filaTotal}`).value as { formula: string }).formula;
      expect(cuerpo).toMatch(/^SUM\(/);
    });
  }
});
