import { describe, it, expect } from "vitest";
import { editarDecision, estadoDe } from "../lib/engine/edicion";
import { completarConRespeto, decisionRespetar } from "../lib/ia/motor-ajuste";
import { armarFilas } from "../lib/engine/filas";
import { validarSalida } from "../lib/ia/validadores";
import type { LineaReclamacion, SalidaAgente } from "../lib/domain/tipos";

const rec: LineaReclamacion = { item: "1.1", recinto: "LIVING", descripcion: "Pintura", um: "m2", cantidad: 10, pu: 8000 };

describe("edición de partidas por el usuario", () => {
  it("una partida sin decisión se ve «sin tocar» y se acepta lo reclamado", () => {
    expect(estadoDe(undefined)).toBe("sin_tocar");
    expect(estadoDe(decisionRespetar(rec))).toBe("sin_tocar");
    const filas = armarFilas({ caso: { modo: "reclamacion" }, reclamacion: { secciones: [{ numero: "1.0", titulo: "LIVING" }], lineas: [rec], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 }, decisiones: [], adicionales: [] });
    const l = filas.find((f) => f.tipo === "linea");
    expect(l && l.tipo === "linea" && l.aj).toEqual({ um: "m2", cantidad: 10, pu: 8000 });
  });
  it("editar la cantidad marca C sola y deja la partida en verde (usuario)", () => {
    const d = editarDecision(rec, undefined, { cantidad: 4 });
    expect(d).toMatchObject({ accion: "ajustar", cantidad: 4, pu: 8000, obs: ["C"], fuente: "usuario", pu_origen: "reclamacion" });
    expect(estadoDe(d)).toBe("usuario");
  });
  it("editar el precio marca B y lo da por precio manual", () => {
    const d = editarDecision(rec, undefined, { pu: 5000 });
    expect(d).toMatchObject({ pu: 5000, obs: ["B"], pu_origen: "mercado:manual" });
  });
  it("volver a los valores reclamados deja F (respetar) y sigue siendo del usuario", () => {
    const d = editarDecision(rec, editarDecision(rec, undefined, { cantidad: 4 }), { cantidad: 10 });
    expect(d).toMatchObject({ accion: "respetar", obs: ["F"], cantidad: 10, pu: 8000, fuente: "usuario" });
  });
  it("F es exclusiva: marcar otra letra la quita y marcar F devuelve lo reclamado", () => {
    const a = editarDecision(rec, undefined, { alternar: "A" });
    expect(a.obs).toEqual(["A"]);
    const f = editarDecision(rec, a, { alternar: "F" });
    expect(f).toMatchObject({ obs: ["F"], cantidad: 10, pu: 8000 });
  });
  it("lo que edita el usuario valida y el guardado completa las partidas faltantes", () => {
    const recl = { secciones: [], lineas: [rec, { ...rec, item: "1.2" }], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 };
    const lineas = completarConRespeto(recl.lineas, [editarDecision(rec, undefined, { cantidad: 4 })]);
    expect(lineas.map((l) => l.item)).toEqual(["1.1", "1.2"]);
    const salida = { caracteristicas: {}, evidencia_observada: [], lineas, lineas_adicionales: [], ajuste_de_perdida_texto: "x", resumen_ajuste: ["a", "b", "c"], faltantes: [] } as unknown as SalidaAgente;
    const v = validarSalida(salida, { reclamacion: recl, fotosIds: new Set(), fuentesMercado: new Set(), modo: "reclamacion" });
    expect(v.errores.filter((e) => /partida/i.test(e))).toEqual([]);
  });
});
