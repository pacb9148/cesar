import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { leerPlanilla } from "../lib/extraccion/planilla";
import { textoPdf } from "../lib/extraccion/pdf";
import { parsearActa } from "../lib/extraccion/acta";
import { BAREMO } from "../lib/engine/baremo";
import { ajustarCaso } from "../lib/ia/agente";
import type { ClienteLlm } from "../lib/ia/gemini";
import { CLAVES_CARACTERISTICAS, type SalidaAgente } from "../lib/domain/tipos";
import { calcularTotales } from "../lib/engine/totales";

/** Cliente simulado: repite la planilla emitida por el perito como si fuera la respuesta del modelo. */
async function clienteDeReferencia(ruta: string) {
  const p = await leerPlanilla(ruta);
  const dato = { valor: null, estado: "faltante" as const, evidencia: [] };
  const salida: SalidaAgente = {
    caracteristicas: Object.fromEntries(CLAVES_CARACTERISTICAS.map((k) => [k, dato])) as unknown as SalidaAgente["caracteristicas"],
    evidencia_observada: [],
    lineas: p.decisiones.map((d) => {
      const baremo = BAREMO.find((b) => b.pu === d.pu);
      const obs = d.cantidad === 0 ? ["A" as const] : d.obs.length ? d.obs.map((o) => (o === "C" ? "B" : o)) : ["B" as const];
      return { ...d, obs: obs as typeof d.obs, pu_origen: baremo ? `baremo:${baremo.id}` : "mercado:planilla", justificacion: "Ajuste según planilla de referencia" };
    }),
    lineas_adicionales: p.adicionales,
    ajuste_de_perdida_texto: "Se ajustaron precios unitarios y cantidades a la cubicación del acta.",
    resumen_ajuste: ["Se recortaron cantidades a los m² del acta (C).", "Precios llevados a baremo a todo costo (B).", "Faenas absorbidas en gastos generales (E)."],
    faltantes: [],
  };
  let llamadas = 0;
  const cliente: ClienteLlm = {
    async generarJson() {
      llamadas++;
      return { texto: JSON.stringify(salida), modelo: "simulado", tokensEntrada: 10, tokensSalida: 10 };
    },
  };
  return { cliente, p, llamadas: () => llamadas };
}

describe("agente de ajuste (con cliente simulado)", () => {
  it("caso 1: acepta la salida de referencia y el motor da UF 46,73", async () => {
    const { cliente, p } = await clienteDeReferencia(globSync("fuente/1981023*/1981023 Ajuste v1.xlsx")[0]);
    const acta = parsearActa(await textoPdf(readFileSync(globSync("fuente/1981023*/TEXTO/INSP*.pdf")[0])));
    const r = await ajustarCaso(
      {
        modo: "reclamacion",
        fechaSiniestro: "2026-07-16",
        valorUF: p.valorUF!,
        acta,
        reclamacion: p.reclamacion,
        fotos: [],
        preciosMercado: [{ fuente: "planilla", descripcion: "precio de la planilla de referencia", pu: 0 }],
      },
      cliente,
    );
    expect(r.validacion.errores, r.validacion.errores.join("\n")).toEqual([]);
    const aj = calcularTotales(
      [...r.salida.lineas.map((l) => ({ cantidad: l.cantidad, pu: l.pu })), ...r.salida.lineas_adicionales],
      { ggPct: p.reclamacion.ggPct, utilidadPct: p.reclamacion.utilidadPct, ivaPct: p.reclamacion.ivaPct, valorUF: p.valorUF! },
    );
    expect(aj.uf).toBeCloseTo(46.73, 1);
  });

  it("reintenta con los errores del validador cuando el modelo rompe una regla", async () => {
    const { p } = await clienteDeReferencia(globSync("fuente/1981023*/1981023 Ajuste v1.xlsx")[0]);
    const acta = parsearActa(await textoPdf(readFileSync(globSync("fuente/1981023*/TEXTO/INSP*.pdf")[0])));
    let n = 0;
    const cliente: ClienteLlm = {
      async generarJson({ partes }) {
        n++;
        const texto = JSON.stringify({
          caracteristicas: Object.fromEntries(CLAVES_CARACTERISTICAS.map((k) => [k, { valor: null, estado: "faltante", evidencia: [] }])),
          evidencia_observada: [],
          lineas: n === 1 ? [] : p.decisiones.map((d) => ({ ...d, obs: d.cantidad === 0 ? ["A"] : ["B"], pu_origen: "reclamacion", pu: d.pu, justificacion: "x x x" })),
          lineas_adicionales: [],
          ajuste_de_perdida_texto: n === 1 ? "Se presume que no hay daño." : "Ajustado.",
          resumen_ajuste: ["a", "b", "c"],
          faltantes: [],
        });
        if (n === 2) expect(JSON.stringify(partes)).toContain("CORRIGE");
        return { texto, modelo: "simulado" };
      },
    };
    const r = await ajustarCaso({ modo: "reclamacion", fechaSiniestro: "2026-07-16", valorUF: 1, acta, reclamacion: p.reclamacion, fotos: [], preciosMercado: [] }, cliente, 2);
    expect(n).toBe(2);
    // En el segundo intento sigue habiendo errores de precio (origen "reclamacion" con otro precio): quedan a la vista.
    expect(r.intentos).toBe(2);
  });
});
