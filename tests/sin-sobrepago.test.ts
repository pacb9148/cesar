import { describe, it, expect } from "vitest";
import { decidirLinea, type Clasificacion } from "../lib/ia/motor-ajuste";
import { BAREMO } from "../lib/engine/baremo";
import type { LineaReclamacion } from "../lib/domain/tipos";

const linea = (p: Partial<LineaReclamacion>): LineaReclamacion => ({ item: "4.1", recinto: "GENERAL", descripcion: "Planchas", um: "un", cantidad: 14, pu: 10320, ...p });
const ctx = { cub: null, m2Acta: null };
const caro = [...BAREMO].sort((a, b) => b.pu - a.pu)[0];

describe("el ajuste nunca paga más que el presupuesto", () => {
  it("partida absorbida con baremo más caro y otra unidad no supera el total reclamado", () => {
    const l = linea({});
    const c: Clasificacion = { item: l.item, categoria: "absorbida", baremo_id: caro.id, base: "reclamada", um_ajuste: "gl", baremo_id_pintura: null };
    const d = decidirLinea(l, c, ctx).decision;
    expect((d.cantidad ?? 0) * (d.pu ?? 0)).toBeLessThanOrEqual(l.cantidad * l.pu);
  });
  it("misma unidad: el precio nunca sube y la cantidad mínima 1 no encarece", () => {
    const l = linea({ um: "gl", cantidad: 1, pu: 50 });
    const c: Clasificacion = { item: l.item, categoria: "absorbida", baremo_id: caro.id, base: "reclamada", um_ajuste: null, baremo_id_pintura: null };
    const d = decidirLinea(l, c, ctx).decision;
    expect(d.pu).toBeLessThanOrEqual(50);
  });
  it("la partida absorbida ya no lleva justificación repetida", () => {
    const c: Clasificacion = { item: "4.1", categoria: "absorbida", baremo_id: null, base: "reclamada", um_ajuste: null, baremo_id_pintura: null };
    expect(decidirLinea(linea({}), c, ctx).decision.justificacion).toBe("");
  });
});
