import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { leerPlanilla } from "../lib/extraccion/planilla";
import { textoPdf } from "../lib/extraccion/pdf";
import { parsearActa } from "../lib/extraccion/acta";
import { BAREMO } from "../lib/engine/baremo";
import { ajustarCaso, textoDePartida, type AlmacenPartidas } from "../lib/ia/agente";
import type { ClienteLlm } from "../lib/ia/gemini";
import { decidirLinea, type Clasificacion } from "../lib/ia/motor-ajuste";
import { CLAVES_CARACTERISTICAS } from "../lib/domain/tipos";
import type { LineaReclamacion } from "../lib/domain/tipos";

const narrativaValida = {
  caracteristicas: Object.fromEntries(CLAVES_CARACTERISTICAS.map((k) => [k, { valor: null, estado: "faltante", evidencia: [] }])),
  evidencia_observada: [],
  lineas_adicionales: [],
  ajuste_de_perdida_texto: "Ajustado a la medición del acta.",
  resumen_ajuste: ["Se acotaron cantidades (C).", "Precios a baremo (B).", "Faenas absorbidas (E)."],
  faltantes: [],
};

async function caso1() {
  const p = await leerPlanilla(globSync("fuente/1981023*/1981023 Ajuste v1.xlsx")[0]);
  const acta = parsearActa(await textoPdf(readFileSync(globSync("fuente/1981023*/TEXTO/INSP*.pdf")[0])));
  return { p, acta, entrada: { modo: "reclamacion" as const, fechaSiniestro: "2026-07-16", valorUF: p.valorUF!, acta, reclamacion: p.reclamacion, fotos: [], preciosMercado: [] } };
}

/** Modelo simulado: clasifica cada partida como «ajustar» con su primer candidato de baremo, y redacta con una narrativa válida. */
function clienteQueClasifica(opciones: { falla?: (item: string) => boolean } = {}): ClienteLlm & { llamadas: () => number; items: string[] } {
  let n = 0;
  const items: string[] = [];
  return {
    llamadas: () => n,
    items,
    async generarJson({ system, partes }) {
      n++;
      if (system.includes("CLASIFICAR")) {
        const t = (partes[0] as { text: string }).text;
        const datos = JSON.parse(t.slice(t.indexOf("{"))) as { partida: { item: string; baremo_candidatos: { id: number }[] } };
        items.push(datos.partida.item);
        if (opciones.falla?.(datos.partida.item)) return { texto: "no es json", modelo: "simulado" };
        const c: Omit<Clasificacion, "item"> = { categoria: "ajustar", baremo_id: datos.partida.baremo_candidatos[0]?.id ?? null, base: "acta_m2", um_ajuste: null, baremo_id_pintura: null };
        return { texto: JSON.stringify(c), modelo: "simulado", tokensEntrada: 10, tokensSalida: 10 };
      }
      return { texto: JSON.stringify(narrativaValida), modelo: "simulado", tokensEntrada: 10, tokensSalida: 10 };
    },
  };
}

function almacenEnMemoria(): AlmacenPartidas & { guardados: Map<string, unknown> } {
  const guardados = new Map<string, unknown>();
  return {
    guardados,
    previas: async () => new Map([...guardados].flatMap(([k, v]) => (v && typeof v === "object" && "categoria" in v ? [[k, v as Clasificacion] as const] : []))),
    guardar: async (item, r) => void guardados.set(item, r.ok ? r.clasificacion : null),
  };
}

describe("ajuste: lectura partida por partida + motor + redacción", () => {
  it("caso 1: una petición por partida, todas decididas y el ajuste valida", async () => {
    const { entrada } = await caso1();
    const cli = clienteQueClasifica();
    const r = await ajustarCaso(entrada, cli);
    expect(r.validacion.errores, r.validacion.errores.join("\n")).toEqual([]);
    expect(r.salida.lineas.map((l) => l.item)).toEqual(entrada.reclamacion.lineas.map((l) => l.item));
    expect(cli.items.sort()).toEqual(entrada.reclamacion.lineas.map((l) => l.item).sort());
    expect(cli.llamadas()).toBe(entrada.reclamacion.lineas.length + 1);
  });

  it("cada petición contiene una sola partida y es chica", async () => {
    const { entrada } = await caso1();
    for (const l of entrada.reclamacion.lineas) {
      const t = textoDePartida(entrada, l);
      expect(t.length).toBeLessThan(6_000);
      expect(JSON.parse(t.slice(t.indexOf("{"))).partida.item).toBe(l.item);
    }
  });

  it("guarda cada resultado al llegar y, al retomar, solo lee las que faltaban", async () => {
    const { entrada } = await caso1();
    const almacen = almacenEnMemoria();
    const todas = entrada.reclamacion.lineas.map((l) => l.item);
    const corta = new Set(todas.slice(0, 5));
    // Primera corrida: el proveedor deja de responder a partir de la 6.ª partida.
    let vistas = 0;
    const caido: ClienteLlm = {
      async generarJson(o) {
        if (o.system.includes("CLASIFICAR") && ++vistas > 5) throw new Error("Ningún proveedor de IA respondió.");
        return clienteQueClasifica().generarJson(o);
      },
    };
    await expect(ajustarCaso(entrada, caido, almacen)).rejects.toThrow(/Se leyeron \d+ de \d+ partidas y quedaron guardadas/);
    expect([...almacen.guardados.values()].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    const yaLeidas = new Set([...almacen.guardados].filter(([, v]) => v).map(([k]) => k));
    // Segunda corrida: no repite las ya leídas.
    const cli = clienteQueClasifica();
    const r = await ajustarCaso(entrada, cli, almacen);
    expect(r.validacion.errores).toEqual([]);
    expect(cli.items.some((i) => yaLeidas.has(i))).toBe(false);
    expect(cli.items.length + yaLeidas.size).toBe(todas.length);
    void corta;
  });

  it("una partida con respuesta inválida se resuelve por reglas automáticas y las demás siguen", async () => {
    const { entrada } = await caso1();
    const malas = new Set(entrada.reclamacion.lineas.slice(0, 2).map((l) => l.item));
    const r = await ajustarCaso(entrada, clienteQueClasifica({ falla: (i) => malas.has(i) }));
    expect(r.validacion.errores, r.validacion.errores.join("\n")).toEqual([]);
    expect(r.avisos.join(" ")).toMatch(/2 partida\(s\) no fueron clasificadas por la IA/);
  });

  it("si el modelo contesta basura en todo, el motor resuelve por defecto y el resultado igual valida", async () => {
    const { entrada } = await caso1();
    const cliente: ClienteLlm = { generarJson: async () => ({ texto: "no es json", modelo: "simulado" }) };
    const r = await ajustarCaso(entrada, cliente);
    expect(r.validacion.errores, r.validacion.errores.join("\n")).toEqual([]);
    expect(r.avisos.join(" ")).toMatch(/no fueron clasificadas por la IA/);
    expect(r.avisos.join(" ")).toMatch(/texto automático/);
  });

  it("sin ningún proveedor la lectura se detiene con un mensaje claro (no se inventa un ajuste)", async () => {
    const { entrada } = await caso1();
    const cliente: ClienteLlm = { generarJson: async () => { throw new Error("Ningún proveedor de IA respondió."); } };
    await expect(ajustarCaso(entrada, cliente)).rejects.toThrow(/Ningún proveedor/);
  });
});

describe("motor: contrasta lo presupuestado con el máximo permitido", () => {
  const baremo = BAREMO.find((b) => b.pu > 1000)!;
  const linea = (o: Partial<LineaReclamacion> = {}): LineaReclamacion => ({ item: "1.1", recinto: "LIVING", descripcion: "x", um: "m2", cantidad: 10, pu: baremo.pu * 2, ...o });
  const clas = (o: Partial<Clasificacion> = {}): Clasificacion => ({ item: "1.1", categoria: "ajustar", baremo_id: baremo.id, base: "acta_m2", um_ajuste: null, baremo_id_pintura: null, ...o });
  const ctx = { cub: null, m2Acta: 4 };

  it("baja el precio al baremo y la cantidad a la medición del acta (B y C)", () => {
    const { decision: d } = decidirLinea(linea(), clas(), ctx);
    expect(d).toMatchObject({ accion: "ajustar", pu: baremo.pu, pu_origen: `baremo:${baremo.id}`, cantidad: 4 });
    expect(d.obs).toEqual(["B", "C"]);
  });
  it("nunca sube lo reclamado: si ya está bajo el máximo, se respeta (F)", () => {
    const { decision: d } = decidirLinea(linea({ pu: baremo.pu - 1, cantidad: 3 }), clas(), ctx);
    expect(d.accion).toBe("respetar");
    expect(d.obs).toEqual(["F"]);
  });
  it("absorbida → cantidad mínima 1 con E; ajena → 1 con A; preventiva → 1 con D; nada va a 0", () => {
    const a = decidirLinea(linea(), clas({ categoria: "absorbida" }), ctx).decision;
    const b = decidirLinea(linea(), clas({ categoria: "ajena" }), ctx).decision;
    const c = decidirLinea(linea(), clas({ categoria: "preventiva" }), ctx).decision;
    expect([a.cantidad, a.obs]).toEqual([1, ["E"]]);
    expect([b.cantidad, b.obs]).toEqual([1, ["A"]]);
    expect([c.cantidad, c.obs]).toEqual([1, ["D"]]);
    for (const d of [a, b, c]) expect(d.pu).toBeGreaterThan(0);
  });
  it("al convertir de unidad (lista de supermercado → m²) manda el baremo y la medida", () => {
    const { decision: d } = decidirLinea(linea({ um: "un", cantidad: 12, pu: 5000 }), clas({ um_ajuste: "m2", base: "acta_m2" }), ctx);
    expect(d).toMatchObject({ um: "m2", cantidad: 4, pu: baremo.pu });
  });
  it("sin medición para la base elegida mantiene lo reclamado y avisa", () => {
    const r = decidirLinea(linea({ pu: baremo.pu }), clas({ base: "pano" }), { cub: null, m2Acta: null });
    expect(r.decision.accion).toBe("respetar");
    expect(r.aviso).toMatch(/no hay medición/);
  });
  it("partida agrupada: queda en blanco y se desglosa en 2 sub-líneas a baremo", () => {
    const { decision: d } = decidirLinea(linea(), clas({ categoria: "desglosar", baremo_id_pintura: BAREMO[1].id }), ctx);
    expect(d.accion).toBe("desglosar");
    expect([d.cantidad, d.pu]).toEqual([null, null]);
    expect(d.sublineas).toHaveLength(2);
    expect(d.sublineas.every((s) => s.pu_origen.startsWith("baremo:"))).toBe(true);
  });
});
