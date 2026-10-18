import { describe, it, expect, beforeAll } from "vitest";
import { aprendidoVacio, baremoSugerido, extrasDeElemento, normClave, elementoDe, SEMILLA } from "../lib/conocimiento";
import { partidasDeEvidencia, extrasDeMemoria } from "../lib/caso/partidas-evidencia";
import type { SalidaAgente, Reclamacion } from "../lib/domain/tipos";
import { salidaBase } from "../lib/caso/ajuste-base";

describe("memoria del sistema (pura)", () => {
  it("normaliza descripciones: sin tildes, mayúsculas ni palabras vacías", () => {
    expect(normClave("Provi. y Colocación de  Plancha")).toBe(normClave("provision colocacion plancha"));
    expect(elementoDe("Cielo - Pintura")).toBe("cielo");
    expect(elementoDe("Retiro guardapolvos")).toBe("guardapolvo");
    expect(elementoDe("Instalación cubierta zinc")).toBe("cubierta");
  });
  it("la semilla de los ajustes de referencia sugiere la partida de la hoja Datos y lo aprendido del usuario manda sobre ella", () => {
    const k = Object.keys(SEMILLA.partidas)[0];
    expect(SEMILLA.asociadas).toBeGreaterThan(100);
    const idSemilla = baremoSugerido(aprendidoVacio(), k);
    expect(idSemilla).not.toBeNull();
    const a = aprendidoVacio();
    a.partidas.set(normClave(k), new Map([[999999, 5]]));
    expect(baremoSugerido(a, k)).toBe(999999);
    expect(baremoSugerido(aprendidoVacio(), "una descripción que nunca se vio xyz")).toBeNull();
  });
  it("las partidas extra por elemento exigen verse al menos 2 veces y en la mitad de las estancias", () => {
    const a = aprendidoVacio();
    a.elementos.set("cielo", { secciones: 4, ids: new Map([[5, { veces: 3, um: "m2" }], [6, { veces: 1, um: "m2" }], [2, { veces: 4, um: "m2" }]]) });
    expect(extrasDeElemento(a, "cielo", [2, 3, 37])).toEqual([{ id: 5, um: "m2" }]);
    expect(extrasDeElemento(a, "muro", [])).toEqual([]);
    a.elementos.set("cielo", { secciones: 1, ids: new Map([[5, { veces: 3, um: "m2" }]]) });
    expect(extrasDeElemento(a, "cielo", [])).toEqual([]);
  });
  it("las partidas generadas desde la evidencia incorporan los extras aprendidos con su unidad", () => {
    const a = aprendidoVacio();
    a.elementos.set("cielo", { secciones: 3, ids: new Map([[123, { veces: 3, um: "m2" }]]) });
    const danos = [{ recinto: "Sala", alto: 2.4, ancho: 3, largo: 3, descripcion: "Daños en cielo por agua", tipoDano: "Afectado por agua", um: "m2", cantidad: 6 }];
    const sin = partidasDeEvidencia({ danos }).partidas;
    const con = partidasDeEvidencia({ danos }, { aprendido: a }).partidas;
    expect(con.length).toBe(sin.length + 1);
    expect(extrasDeMemoria(a).cielo).toEqual([{ id: 123, um: "m2" }]);
  });
});

describe("memoria del sistema (con base de datos)", () => {
  let repo: typeof import("../lib/conocimiento/repo");
  let u: string;
  beforeAll(async () => {
    process.env.DB_MODE = "pglite";
    process.env.PGLITE_DIR = "memory";
    process.env.APP_SECRET = "d".repeat(64);
    const { consulta } = await import("../lib/db");
    repo = await import("../lib/conocimiento/repo");
    u = String((await consulta<{ id: string }>("insert into usuarios(email,nombre,hash_clave) values ('m@m.cl','M','x') returning id"))[0].id);
  });
  const recl: Reclamacion = { secciones: [{ numero: "1.0", titulo: "Cocina" }], lineas: [{ item: "1.1", recinto: "Cocina", descripcion: "Aplicación de pintura al cielo", um: "m2", cantidad: 10, pu: 9000 }], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 };
  const salida = (): SalidaAgente => ({
    ...salidaBase(null),
    lineas: [{ item: "1.1", accion: "ajustar", um: "m2", cantidad: 8, pu: 8400, pu_origen: "baremo:37", obs: ["B"], justificacion: "x", sublineas: [] }],
    lineas_adicionales: [
      { seccion: "SALA", elemento: "Cielo", descripcion: "Retiro cielo dañado", um: "m2", cantidad: 3, pu: 2400, pu_origen: "baremo:110", obs: ["B"], justificacion: "x y z" },
    ],
  });
  it("aprende de un ajuste guardado y lo recuerda al volver a leer", async () => {
    const r = await repo.aprenderDeAjuste(u, { reclamacion: recl, salida: salida() });
    expect(r.partidas).toBeGreaterThanOrEqual(2);
    const a = await repo.leerAprendido(u);
    expect(baremoSugerido(a, "Aplicación de pintura al cielo")).toBe(37);
    expect(a.elementos.get("cielo")?.secciones).toBe(1);
    // repetir refuerza el conteo y cuenta otra estancia
    await repo.aprenderDeAjuste(u, { reclamacion: recl, salida: salida() });
    const b = await repo.leerAprendido(u);
    expect(b.partidas.get(normClave("Aplicación de pintura al cielo"))?.get(37)).toBe(2);
    expect(b.elementos.get("cielo")?.secciones).toBe(2);
  });
  it("lista la memoria y permite olvidar una entrada", async () => {
    const lista = await repo.listarMemoria(u);
    expect(lista.length).toBeGreaterThan(0);
    const e = lista.find((x) => x.tipo === "partida")!;
    await repo.olvidar(u, e.tipo, e.clave);
    expect((await repo.listarMemoria(u)).some((x) => x.clave === e.clave && x.tipo === e.tipo)).toBe(false);
  });
});
