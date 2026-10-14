import { describe, it, expect, beforeAll } from "vitest";
import { salidaBase } from "../lib/caso/ajuste-base";
import { validarSalida } from "../lib/ia/validadores";
import { armarFilas } from "../lib/engine/filas";
import type { Reclamacion } from "../lib/domain/tipos";

describe("ajuste «sin ajustar» (sin IA)", () => {
  const recl: Reclamacion = { secciones: [{ numero: "1.0", titulo: "Cocina" }], lineas: [{ item: "1.1", recinto: "Cocina", descripcion: "Pintura", um: "m2", cantidad: 10, pu: 5000 }], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 };
  it("es un ajuste válido que acepta todo lo reclamado", () => {
    const s = salidaBase(null);
    const v = validarSalida(s, { reclamacion: recl, fotosIds: new Set(), fuentesMercado: new Set(), modo: "reclamacion" });
    expect(v.errores).toEqual([]);
    const f = armarFilas({ caso: { modo: "reclamacion" }, reclamacion: recl, decisiones: s.lineas, adicionales: [] });
    const l = f.find((x) => x.tipo === "linea")!;
    expect(l.tipo === "linea" && l.aj).toEqual(l.tipo === "linea" ? l.rec : null);
    expect(l.tipo === "linea" && l.obs).toEqual(["F"]);
  });
});

describe("casos: crear, renombrar y eliminar sin duplicar ni dejar basura", () => {
  let repo: typeof import("../lib/caso/repositorio");
  let consulta: typeof import("../lib/db").consulta;
  let u: string;
  beforeAll(async () => {
    process.env.DB_MODE = "pglite";
    process.env.PGLITE_DIR = "memory";
    process.env.APP_SECRET = "c".repeat(64);
    ({ consulta } = await import("../lib/db"));
    repo = await import("../lib/caso/repositorio");
    u = String((await consulta<{ id: string }>("insert into usuarios(email,nombre,hash_clave) values ('c@c.cl','C','x') returning id"))[0].id);
  });

  it("«Nuevo caso» reutiliza el caso en blanco en vez de acumular filas vacías", async () => {
    const a = await repo.crearOReutilizarCasoVacio(u);
    const b = await repo.crearOReutilizarCasoVacio(u);
    expect(a.reutilizado).toBe(false);
    expect(b.reutilizado).toBe(true);
    expect(b.caso.id).toBe(a.caso.id);
    expect((await repo.listarCasos(u)).length).toBe(1);
    await repo.guardarArchivo({ casoId: a.caso.id, nombre: "x.pdf", tipo: "acta", mime: "application/pdf", contenido: Buffer.from("x") });
    const c = await repo.crearOReutilizarCasoVacio(u); // el primero ya tiene archivos: hace falta uno nuevo
    expect(c.reutilizado).toBe(false);
    expect(c.caso.id).not.toBe(a.caso.id);
  });

  it("no admite dos casos con el mismo siniestro y renombra también los datos", async () => {
    const casos = await repo.listarCasos(u);
    await repo.renombrarCaso(casos[0].id, "1992286");
    expect((await repo.obtenerCaso(casos[0].id, u))?.datos.siniestro).toBe("1992286");
    expect((await repo.casoConSiniestro(u, "1992286", casos[1].id))?.id).toBe(casos[0].id);
    expect(await repo.casoConSiniestro(u, "1992286", casos[0].id)).toBeNull();
    expect(await repo.casoConSiniestro(u, repo.SIN_NUMERO)).toBeNull(); // «sin número» nunca cuenta como duplicado
  });

  it("al guardar ajustes solo se conservan las últimas versiones", async () => {
    const [c] = await repo.listarCasos(u);
    const s = salidaBase(null);
    for (let i = 0; i < repo.VERSIONES_AJUSTE_MAX + 4; i++) await repo.guardarAjuste(c.id, s, "manual");
    const n = Number((await consulta<{ n: number }>("select count(*)::int as n from ajustes where caso_id = $1", [c.id]))[0].n);
    expect(n).toBe(repo.VERSIONES_AJUSTE_MAX);
    expect((await repo.ultimoAjuste(c.id))?.version).toBe(repo.VERSIONES_AJUSTE_MAX + 4);
  });

  it("eliminar un caso borra todo lo suyo, incluidos registros sin cascada, y solo de su dueño", async () => {
    const [c] = await repo.listarCasos(u);
    await repo.guardarExtraccion(c.id, "borrador", { x: 1 });
    await repo.registrarLlm({ casoId: c.id, tarea: "t", modelo: "m", promptVersion: "v", ok: true });
    await repo.auditar(u, c.id, "prueba");
    const otro = String((await consulta<{ id: string }>("insert into usuarios(email,nombre,hash_clave) values ('d@d.cl','D','x') returning id"))[0].id);
    expect(await repo.eliminarCaso(c.id, otro)).toBe(false);
    expect(await repo.eliminarCaso(c.id, u)).toBe(true);
    for (const t of ["archivos", "extracciones", "ajustes", "llm_runs", "auditoria"]) {
      expect(Number((await consulta<{ n: number }>(`select count(*)::int as n from ${t} where caso_id = $1`, [c.id]))[0].n)).toBe(0);
    }
    expect(await repo.obtenerCaso(c.id, u)).toBeNull();
  });
});
