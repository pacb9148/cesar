import { describe, it, expect } from "vitest";
import { auditarAjuste } from "../lib/engine/auditoria";
import { armarFilas } from "../lib/engine/filas";
import { decidirLinea, clasificacionPorDefecto } from "../lib/ia/motor-ajuste";
import { editarDecision } from "../lib/engine/edicion";
import type { DecisionLinea, Reclamacion } from "../lib/domain/tipos";

const recl: Reclamacion = {
  secciones: [{ numero: "1.0", titulo: "Cocina" }],
  lineas: [
    { item: "1.1", recinto: "Cocina", descripcion: "Pintura muro", um: "m2", cantidad: 30, pu: 9800 },
    { item: "1.2", recinto: "Cocina", descripcion: "Retiro de escombros", um: "gl", cantidad: 1, pu: 60000 },
    { item: "1.3", recinto: "Cocina", descripcion: "Sello", um: "ml", cantidad: 0.5, pu: 4500 },
  ],
  totalDirectoDeclarado: null,
  ggPct: 0.25,
  utilidadPct: 0,
  ivaPct: 0.19,
};
const filasCon = (decisiones: DecisionLinea[]) => armarFilas({ caso: { modo: "reclamacion" }, reclamacion: recl, decisiones, adicionales: [] });

describe("auditoría de reglas duras ACAS", () => {
  it("sin decisiones se acepta lo reclamado y todo cumple", () => {
    const a = auditarAjuste(filasCon([]), recl);
    expect(a.cumple).toBe(true);
    expect(a.partidasReclamadas).toBe(3);
    expect(a.partidasAjustadas).toBe(0);
    expect(a.conteoObs.F).toBe(3);
  });

  it("una partida ajena o absorbida nunca queda en 0: cantidad mínima 1 y letra A/E", () => {
    const d = decidirLinea(recl.lineas[0], { ...clasificacionPorDefecto(recl.lineas[0]), categoria: "ajena" }, { cub: null, m2Acta: null }).decision;
    expect(d.cantidad).toBe(1);
    expect(d.obs).toEqual(["A"]);
    const e = decidirLinea(recl.lineas[1], { ...clasificacionPorDefecto(recl.lineas[1]), categoria: "absorbida" }, { cub: null, m2Acta: null }).decision;
    expect(e.cantidad).toBe(1);
    expect(auditarAjuste(filasCon([d, e]), recl).cumple).toBe(true);
  });

  it("si lo reclamado ya era menor que 1 se respeta (jamás se sube sobre lo reclamado)", () => {
    const d = decidirLinea(recl.lineas[2], { ...clasificacionPorDefecto(recl.lineas[2]), categoria: "ajena" }, { cub: null, m2Acta: null }).decision;
    expect(d.cantidad).toBe(0.5);
    expect(auditarAjuste(filasCon([d]), recl).cumple).toBe(true);
  });

  it("un precio menor que el baremo se deja igual (no se sube)", () => {
    const l = { ...recl.lineas[0], pu: 100 };
    const d = decidirLinea(l, { ...clasificacionPorDefecto(l), categoria: "ajustar", baremo_id: 1, base: "reclamada" }, { cub: null, m2Acta: null }).decision;
    expect(d.pu).toBe(100);
  });

  it("una edición manual en 0 se lleva al mínimo", () => {
    const d = editarDecision(recl.lineas[0], undefined, { cantidad: 0 });
    expect(d.cantidad).toBe(1);
  });

  it("detecta un precio inflado, un 0 y una partida tocada sin letra", () => {
    const base = (item: string): DecisionLinea => ({ item, accion: "ajustar", um: "m2", cantidad: 30, pu: 9800, pu_origen: "reclamacion", obs: ["B"], justificacion: "prueba manual", sublineas: [] });
    const a = auditarAjuste(filasCon([{ ...base("1.1"), pu: 12000 }]), recl);
    expect(a.cumple).toBe(false);
    expect(a.verificaciones.find((x) => x.codigo === "ERR_PRICE_INFLATION")?.ok).toBe(false);
    const sinLetra = auditarAjuste(filasCon([{ ...base("1.1"), cantidad: 10, obs: [] }]), recl);
    expect(sinLetra.verificaciones.find((x) => x.codigo === "ERR_NO_OBS")?.ok).toBe(false);
  });
});
