import { describe, it, expect, beforeAll } from "vitest";
import { tablasPorGrupo } from "../lib/docs/fotos-xml";
import { seleccionarFotosInforme } from "../lib/docs/fotos-seleccion";
import type { ActaInspeccion } from "../lib/extraccion/acta";

const acta = { danos: [{ recinto: "LIVING", descripcion: "x", tipoDano: "y" }] } as unknown as ActaInspeccion;
const celdas = (g: string, n: number) => Array.from({ length: n }, (_, i) => ({ rid: `${g}${i}`, leyenda: "", grupo: g }));

describe("fotos por grupo", () => {
  it("cada estancia lleva su nombre arriba y, si el usuario la escribió, su leyenda al pie de la última tabla", () => {
    const t = tablasPorGrupo([...celdas("Living", 7), ...celdas("Cocina", 2)], { Living: "Cielo con humedad", Cocina: "  " });
    expect(t).toHaveLength(3); // Living: 6 + 1 fotos = 2 tablas; Cocina: 1 tabla
    expect(t[0]).toContain(">Living<");
    expect(t[1]).toContain("Living (continuación)");
    expect(t[0]).not.toContain("Cielo con humedad");
    expect(t[1]).toContain("Cielo con humedad");
    expect(t[2]).toContain(">Cocina<");
    expect(t[2]).not.toMatch(/<w:i\/><w:sz w:val="20"\/>/); // sin leyenda de grupo no hay fila de pie
  });
  it("la fachada va sola y primero, centrada", () => {
    const t = tablasPorGrupo(celdas("Living", 1), {}, { rid: "F", leyenda: "" });
    expect(t).toHaveLength(2);
    expect(t[0]).toContain("fachada");
    expect(t[0]).not.toContain("Living");
  });
});

describe("selección de fotos del informe", () => {
  const f = (id: number, recinto: string, edicion: { incluir?: boolean; excluir?: boolean } | null = null) => ({ id, recinto, edicion });
  it("parte con las del área afectada, sin que el usuario marque nada", () => {
    const r = seleccionarFotosInforme([f(1, "Living"), f(2, "Living"), f(3, "Baño")], acta);
    expect(r.fotos.map((x) => x.id)).toEqual([1, 2]);
  });
  it("el usuario puede añadir una foto de otro recinto y quitar una automática; el orden se conserva", () => {
    const r = seleccionarFotosInforme([f(1, "Living", { excluir: true }), f(2, "Living"), f(3, "Baño", { incluir: true })], acta);
    expect(r.fotos.map((x) => x.id)).toEqual([2, 3]);
  });
  it("una foto quitada no vuelve aunque sobren otras automáticas", () => {
    const todas = Array.from({ length: 8 }, (_, i) => f(i + 1, "Living", i === 0 ? { excluir: true } : null));
    expect(seleccionarFotosInforme(todas, acta).fotos.map((x) => x.id)).toEqual([2, 3, 4, 5, 6]); // 6 automáticas (1-6) menos la quitada
  });
});

describe("estado del informe frente a los cambios", () => {
  let consulta: typeof import("../lib/db").consulta;
  let casoId: string;
  let gen: typeof import("../lib/caso/generacion");
  beforeAll(async () => {
    process.env.DB_MODE = "pglite";
    process.env.PGLITE_DIR = "memory";
    process.env.APP_SECRET = "c".repeat(64);
    ({ consulta } = await import("../lib/db"));
    gen = await import("../lib/caso/generacion");
    const u = String((await consulta<{ id: string }>("insert into usuarios(email,nombre,hash_clave) values ('g@g.cl','G','x') returning id"))[0].id);
    casoId = String((await consulta<{ id: string }>("insert into casos(usuario_id, siniestro) values ($1,'1') returning id", [u]))[0].id);
  });
  it("queda al día al generar y se desactualiza si cambia un archivo, una foto, el ajuste, los datos o una leyenda de grupo", async () => {
    expect(await gen.informeAlDia(casoId)).toBe(false); // nunca se generó
    await gen.marcarAlDia(casoId);
    expect(await gen.informeAlDia(casoId)).toBe(true);
    await consulta("insert into archivos(caso_id, nombre, tipo, mime, tamano, sha256, recinto, contenido) values ($1,'a.jpg','foto','image/jpeg',1,'h1','Living',$2)", [casoId, Buffer.from("x")]);
    expect(await gen.informeAlDia(casoId)).toBe(false);
    await gen.marcarAlDia(casoId);
    await consulta("update archivos set edicion = $2::jsonb where caso_id = $1", [casoId, JSON.stringify({ excluir: true })]);
    expect(await gen.informeAlDia(casoId)).toBe(false);
    await gen.marcarAlDia(casoId);
    const { guardarLeyendaGrupo } = await import("../lib/caso/edicion-documentos");
    await guardarLeyendaGrupo(casoId, "Living", "Cielo");
    expect(await gen.informeAlDia(casoId)).toBe(false);
    await gen.marcarAlDia(casoId);
    await consulta("update casos set datos = datos || '{\"ubicacion\":\"otra\"}'::jsonb where id = $1", [casoId]);
    expect(await gen.informeAlDia(casoId)).toBe(false);
    await gen.marcarAlDia(casoId);
    // los avisos de lectura y los documentos generados no cuentan como cambios
    await consulta("update casos set datos = datos || '{\"alertas\":[\"x\"]}'::jsonb where id = $1", [casoId]);
    await consulta("insert into archivos(caso_id, nombre, tipo, mime, tamano, sha256, contenido) values ($1,'i.docx','salida','a',1,'h2',$2)", [casoId, Buffer.from("y")]);
    expect(await gen.informeAlDia(casoId)).toBe(true);
  });
});

import { reordenar, ordenarPorGrupo } from "../lib/fotos/orden";
describe("orden de las fotos dentro de cada estancia", () => {
  it("mueve una foto a la posición pedida (1 = izquierda) y acota los extremos", () => {
    expect(reordenar(["a", "b", "c", "d"], "d", 1)).toEqual(["d", "a", "b", "c"]);
    expect(reordenar(["a", "b", "c", "d"], "a", 3)).toEqual(["b", "c", "a", "d"]);
    expect(reordenar(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
    expect(reordenar(["a", "b", "c"], "c", -5)).toEqual(["c", "a", "b"]);
  });
  it("el informe respeta el índice del usuario por estancia; sin índice conserva el orden original", () => {
    const f = (id: number, recinto: string, orden?: number) => ({ id, recinto, edicion: orden ? { orden } : null });
    const r = seleccionarFotosInforme([f(1, "Living", 3), f(2, "Cocina"), f(3, "Living", 1), f(4, "Living", 2), f(5, "Cocina")], { danos: [{ recinto: "LIVING", descripcion: "", tipoDano: "" }, { recinto: "COCINA", descripcion: "", tipoDano: "" }] } as unknown as ActaInspeccion);
    expect(r.fotos.map((x) => x.id)).toEqual([3, 4, 1, 2, 5]);
    expect(ordenarPorGrupo([f(1, "A", 2), f(2, "A", 1)]).map((x) => x.id)).toEqual([2, 1]);
  });
});
