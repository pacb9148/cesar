import { describe, it, expect } from "vitest";
import { equivalentesDe, mejorEquivalente } from "../lib/caso/equivalencias";
import { ajusteAutomatico } from "../lib/caso/ajuste-automatico";
import { contextoDe } from "../lib/ia/agente";
import { salidaBase } from "../lib/caso/ajuste-base";
import type { Reclamacion } from "../lib/domain/tipos";

const acta = { danos: [{ recinto: "Dormitorio 1", alto: 2.4, largo: 3.4, ancho: 3.25, cantidad: 7.8, um: "m2", tipoDano: "", descripcion: "Cielo con humedad" }], hechos: null } as never;
const linea = (item: string, descripcion: string, um: string, cantidad: number, pu: number) => ({ item, recinto: "DORMITORIO 1", descripcion, um, cantidad, pu });
const reclamacion = (lineas: ReturnType<typeof linea>[]): Reclamacion => ({ secciones: [{ numero: "1.0", titulo: "DORMITORIO 1" }], lineas, totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 }) as unknown as Reclamacion;

describe("equivalencias con la hoja Datos", () => {
  it("reconoce el mismo trabajo descrito con otras palabras", () => {
    const prep = mejorEquivalente("Raspar, enhuinchar y lijar cielo yeso cartón", { um: "m2" });
    expect(prep?.descripcion).toMatch(/Preparaci[oó]n de Superficie Cielo|Empaste y Lijado Cielo/);
    const pintura = mejorEquivalente("Aplicación pintura esmalte al agua similar al existente cielo", { um: "m2" });
    expect(pintura?.descripcion).toMatch(/pintura.*cielo|cielo.*pintura/i);
    const cornisa = mejorEquivalente("Retiro de cornisa dañada", { um: "ml" });
    expect(cornisa?.descripcion).toMatch(/cornisa/i);
  });
  it("no reconoce lo que no está en la hoja Datos ni mezcla materiales u objetos", () => {
    expect(mejorEquivalente("Instalación de lámpara decorativa de diseño", { um: "un" })).toBeNull();
    for (const e of equivalentesDe("Retiro cielo yeso cartón", { um: "m2" })) expect(e.descripcion).not.toMatch(/piso|cubierta|puerta/i);
  });
});

describe("ajuste automático sin IA", () => {
  const e = { reclamacion: reclamacion([
    linea("1.1", "Raspar, enhuinchar y lijar cielo yeso cartón", "m2", 7, 5500),
    linea("1.2", "Aplicación pintura esmalte al agua similar al existente cielo", "m2", 7, 10500),
    linea("1.3", "Instalación de lámpara decorativa de diseño", "un", 1, 50000),
    linea("1.4", "Preparación de Superficie Cielo", "m2", 7, 1500),
  ]) };
  const r = ajusteAutomatico(e, (l) => contextoDe({ acta }, l));
  const de = (item: string) => r.lineas.find((x) => x.item === item)!;

  it("baja al precio de la hoja Datos lo que el contratista cobra de más (letra B)", () => {
    expect(de("1.1").accion).toBe("ajustar");
    expect(de("1.1").pu_origen).toMatch(/^baremo:/);
    expect(de("1.1").pu!).toBeLessThan(5500);
    expect(de("1.1").obs).toContain("B");
    expect(de("1.2").pu!).toBeLessThan(10500);
  });
  it("deja tal cual lo que no reconoce o lo que ya cobra menos: nunca inventa ni sube un valor", () => {
    for (const item of ["1.3", "1.4"]) {
      expect(de(item).accion).toBe("respetar");
      expect(de(item).obs).toEqual(["F"]);
    }
    expect(de("1.4").pu).toBe(1500);
  });
  it("acota la cantidad a la superficie física del recinto y solo si la excede", () => {
    const grande = ajusteAutomatico({ reclamacion: reclamacion([linea("1.1", "Aplicación pintura esmalte al agua cielo", "m2", 60, 10500)]) }, (l) => contextoDe({ acta }, l));
    const d = grande.lineas[0];
    expect(d.cantidad!).toBeLessThan(60);
    expect(d.obs).toEqual(expect.arrayContaining(["B", "C"]));
    expect(de("1.2").cantidad).toBe(7); // 7 m² caben en el cielo (3,4 × 3,25 = 11,05 m²): no se toca
  });
  it("el ajuste base con presupuesto ya viene ajustado (y sin presupuesto sigue sin partidas)", () => {
    const s = salidaBase(acta, { reclamacion: e.reclamacion });
    expect(s.lineas.some((x) => x.accion === "ajustar")).toBe(true);
    expect(salidaBase(acta, { conPartidas: false }).lineas).toEqual([]);
  });
});
