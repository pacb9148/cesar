import { describe, it, expect, beforeAll } from "vitest";
import { ClienteConRespaldo, SinProveedores, clasificarFallo, type Candidato, type InfoFallo, type RegistroSalud } from "../lib/ia/rotacion";
import { ErrorHttp } from "../lib/ia/red-segura";
import type { ClienteLlm } from "../lib/ia/gemini";

const entrada = { system: "s", partes: [{ text: "x" }], schema: {} };
const bueno = (modelo: string): ClienteLlm => ({ generarJson: async () => ({ texto: '{"ok":true}', modelo }) });
const roto = (e: unknown): ClienteLlm => ({ generarJson: async () => { throw e; } });

class Memoria implements RegistroSalud {
  oks: (string | null)[] = [];
  fallos: { id: string | null; info: InfoFallo }[] = [];
  constructor(private lista: Candidato[]) {}
  async candidatos() { return this.lista; }
  async ok(id: string | null) { this.oks.push(id); }
  async fallo(id: string | null, info: InfoFallo) { this.fallos.push({ id, info }); }
}
const cand = (id: string, cliente: ClienteLlm, extra: Partial<Candidato> = {}): Candidato => ({ id, nombre: `P-${id}`, cliente, fallosSeguidos: 0, pausado: false, ...extra });

describe("espera y reanudación ante un límite de uso", () => {
  it("si todos fallan por cuota, espera lo que pide el proveedor y reintenta con el mismo proveedor", async () => {
    let llamadas = 0;
    const cuota: ClienteLlm = { generarJson: async () => { if (llamadas++ === 0) throw new ErrorHttp(429, "You exceeded your current quota. Please retry in 23.4s."); return { texto: "{}", modelo: "m" }; } };
    const esperas: number[] = [];
    const r = await new ClienteConRespaldo(new Memoria([cand("a", cuota)]), 2, async (ms) => void esperas.push(ms)).generarJson(entrada);
    expect(r.modelo).toBe("P-a · m");
    expect(esperas).toEqual([24000]);
  });
  it("sin esperas configuradas, o si el límite pide más de 90 s, falla de inmediato (el avance queda guardado)", async () => {
    await expect(new ClienteConRespaldo(new Memoria([cand("a", roto(new ErrorHttp(429, "cuota", 30)))])).generarJson(entrada)).rejects.toThrow(/Ningún proveedor/);
    const esperas: number[] = [];
    await expect(new ClienteConRespaldo(new Memoria([cand("a", roto(new ErrorHttp(429, "cuota", 600)))]), 3, async (ms) => void esperas.push(ms)).generarJson(entrada)).rejects.toThrow(/Ningún proveedor/);
    expect(esperas).toEqual([]);
  });
  it("un 429 se explica como límite de uso, no como falta de saldo", () => {
    expect(clasificarFallo(new ErrorHttp(429, "You exceeded your current quota, check billing"), 0).error).toMatch(/Límite de uso/);
  });
});

describe("rotación automática de proveedores", () => {
  it("si el primero no responde (503), usa el segundo en la misma petición y deja al primero en pausa", async () => {
    const reg = new Memoria([cand("a", roto(new ErrorHttp(503, "overloaded"))), cand("b", bueno("modelo-b"))]);
    const r = await new ClienteConRespaldo(reg).generarJson(entrada);
    expect(r.modelo).toBe("P-b · modelo-b");
    expect(r.avisos?.[0]).toMatch(/P-a no respondió/);
    expect(reg.oks).toEqual(["b"]);
    expect(reg.fallos).toHaveLength(1);
    expect(reg.fallos[0]).toMatchObject({ id: "a", info: { desactivar: false } });
    expect(reg.fallos[0].info.pausaS).toBeGreaterThan(0);
  });
  it("trata la falta de respuesta de red, 429 y 529 como momentáneos", async () => {
    for (const e of [new ErrorHttp(0, "timeout"), new ErrorHttp(429, "rate limit", 90), new ErrorHttp(529, "overloaded"), new ErrorHttp(500, "boom")]) {
      const reg = new Memoria([cand("a", roto(e)), cand("b", bueno("m"))]);
      await new ClienteConRespaldo(reg).generarJson(entrada);
      expect(reg.fallos[0].info.desactivar, String(e)).toBe(false);
    }
    expect(clasificarFallo(new ErrorHttp(429, "x", 90), 0).pausaS).toBe(90);
  });
  it("una clave rechazada (401/403) desactiva el proveedor hasta que el usuario la corrija", async () => {
    const reg = new Memoria([cand("a", roto(new ErrorHttp(401, "bad key"))), cand("b", bueno("m"))]);
    await new ClienteConRespaldo(reg).generarJson(entrada);
    expect(reg.fallos[0].info.desactivar).toBe(true);
  });
  it("Gemini responde 400 a una clave inválida: se trata como credenciales rechazadas", () => {
    const i = clasificarFallo(new ErrorHttp(400, "API key not valid. Please pass a valid API key."), 0);
    expect(i.desactivar).toBe(true);
    expect(clasificarFallo(new ErrorHttp(410, "model reached end of life"), 0).desactivar).toBe(false);
  });
  it("la falta de saldo se explica como facturación, no como fallo de la petición", () => {
    const i = clasificarFallo(new ErrorHttp(400, "Your credit balance is too low to access the Anthropic API."), 0);
    expect(i.error).toMatch(/Sin saldo/);
    expect(i.desactivar).toBe(false);
    expect(clasificarFallo(new ErrorHttp(402, "Payment required"), 0).error).toMatch(/Sin saldo/);
  });
  it("la pausa crece con los fallos seguidos y tiene tope", () => {
    const a = clasificarFallo(new ErrorHttp(503, "x"), 0).pausaS;
    const b = clasificarFallo(new ErrorHttp(503, "x"), 3).pausaS;
    const c = clasificarFallo(new ErrorHttp(503, "x"), 50).pausaS;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeLessThanOrEqual(3600);
  });
  it("si todos fallan, el error enumera lo ocurrido con cada uno", async () => {
    const reg = new Memoria([cand("a", roto(new ErrorHttp(503, "uno caído"))), cand("b", roto(new ErrorHttp(0, "sin red")))]);
    await expect(new ClienteConRespaldo(reg).generarJson(entrada)).rejects.toThrow(/Ningún proveedor.*uno caído.*sin red/);
    expect(reg.fallos).toHaveLength(2);
  });
  it("sin proveedores activos explica qué hacer", async () => {
    await expect(new ClienteConRespaldo(new Memoria([])).generarJson(entrada)).rejects.toBeInstanceOf(SinProveedores);
  });
  it("un proveedor sano no toca a los demás", async () => {
    const reg = new Memoria([cand("a", bueno("ma")), cand("b", roto(new Error("no debería llamarse")))]);
    const r = await new ClienteConRespaldo(reg).generarJson(entrada);
    expect(r.modelo).toBe("P-a · ma");
    expect(r.avisos).toEqual([]);
    expect(reg.fallos).toEqual([]);
  });
});

describe("estado de salud en la base de datos (Postgres embebido)", () => {
  let repo: typeof import("../lib/ia/repo-proveedores");
  let usuarioId: string;
  beforeAll(async () => {
    process.env.DB_MODE = "pglite";
    process.env.PGLITE_DIR = "memory";
    process.env.APP_SECRET = "c".repeat(64);
    delete process.env.GEMINI_API_KEY;
    const { consulta } = await import("../lib/db");
    repo = await import("../lib/ia/repo-proveedores");
    usuarioId = String((await consulta<{ id: string }>("insert into usuarios(email,nombre,hash_clave) values ('t@t.cl','T','x') returning id"))[0].id);
  });

  it("agrega varios proveedores con prioridad, los mueve y los elimina", async () => {
    const a = await repo.crearProveedor(usuarioId, { nombre: "A", tipo: "anthropic", baseUrl: null, modelo: "claude-x", clave: "sk-ant-aaaaaaaa1111" });
    const b = await repo.crearProveedor(usuarioId, { nombre: "B", tipo: "openrouter", baseUrl: null, modelo: "meta/llama", clave: "sk-or-bbbbbbbb2222" });
    const c = await repo.crearProveedor(usuarioId, { nombre: "C", tipo: "compatible", baseUrl: "https://api.groq.com/openai/v1", modelo: "llama", clave: "gsk_cccccccc3333" });
    expect((await repo.listarProveedores(usuarioId)).map((p) => p.nombre)).toEqual(["A", "B", "C"]);
    await repo.moverProveedor(usuarioId, c, "subir");
    expect((await repo.listarProveedores(usuarioId)).map((p) => p.nombre)).toEqual(["A", "C", "B"]);
    await repo.eliminarProveedor(usuarioId, a);
    const l = await repo.listarProveedores(usuarioId);
    expect(l.map((p) => [p.nombre, p.prioridad])).toEqual([["C", 1], ["B", 2]]);
    expect(JSON.stringify(l)).not.toContain("cccccccc3333".slice(0, 8)); // la clave nunca sale; solo los últimos 4
    expect(l[0].ultimos4).toBe("3333");
    expect(l.every((p) => !p.activo)).toBe(true); // nada entra en servicio sin una prueba correcta
    expect((await repo.configDe(usuarioId, b))?.clave).toBe("sk-or-bbbbbbbb2222");
  });

  it("la prueba correcta activa; el fallo deja fuera de servicio con el motivo; los pausados van al final", async () => {
    const [x, y] = (await repo.listarProveedores(usuarioId)).map((p) => p.id);
    await repo.registrarPrueba(usuarioId, x, { ok: true, ms: 10 });
    await repo.registrarPrueba(usuarioId, y, { ok: false, ms: 10, error: "Credenciales rechazadas (401)" });
    let l = await repo.listarProveedores(usuarioId);
    expect(l[0]).toMatchObject({ activo: true, estado: "ok" });
    expect(l[1]).toMatchObject({ activo: false, estado: "error", ultimoError: "Credenciales rechazadas (401)" });
    await repo.registrarPrueba(usuarioId, y, { ok: true, ms: 10 });
    const reg = new repo.RegistroDb(usuarioId);
    expect((await reg.candidatos()).map((c) => c.nombre)).toEqual(["C", "B"]);
    await reg.fallo(x, { error: "503", pausaS: 120, desactivar: false });
    expect((await reg.candidatos()).map((c) => [c.nombre, c.pausado])).toEqual([["B", false], ["C", true]]); // el pausado queda como último recurso
    await reg.fallo(y, { error: "clave inválida", pausaS: 3600, desactivar: true });
    l = await repo.listarProveedores(usuarioId);
    expect(l.find((p) => p.id === y)).toMatchObject({ activo: false, estado: "error" });
    await reg.ok(x);
    expect((await reg.candidatos()).map((c) => [c.nombre, c.pausado])).toEqual([["C", false]]);
  });
});
