import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSeguro, ErrorHttp } from "../lib/ia/red-segura";

const respuesta = (estado: number, cuerpo: unknown, cab: Record<string, string> = {}) => new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status: estado, headers: cab });
const falla = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as ErrorHttp;

afterEach(() => vi.unstubAllGlobals());

describe("salida a los proveedores (fetch integrado + guardas)", () => {
  it("rechaza lo que no es https, las IP privadas y los puertos raros sin llegar a conectar", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const url of ["http://api.openai.com/v1/x", "https://127.0.0.1/v1/x", "https://10.0.0.5/x", "https://[::1]/x", "https://api.openai.com:8080/x"]) {
      expect((await falla(fetchSeguro(url, { cuerpo: {} }))).estado).toBe(400);
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("envía una petición JSON normal, sin redirecciones, y devuelve el JSON", async () => {
    const f = vi.fn(async () => respuesta(200, { choices: [{ message: { content: "OK" } }] }));
    vi.stubGlobal("fetch", f);
    const r = (await fetchSeguro("https://api.openai.com/v1/chat/completions", { cabeceras: { Authorization: "Bearer x" }, cuerpo: { a: 1 } })) as { choices: unknown[] };
    expect(r.choices).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init).toMatchObject({ method: "POST", redirect: "manual", body: JSON.stringify({ a: 1 }) });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer x");
  });
  it("traduce los errores del proveedor: estado, mensaje y Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(429, { error: { message: "cuota" } }, { "retry-after": "30" })));
    const e = await falla(fetchSeguro("https://api.openai.com/v1/x", { cuerpo: {} }));
    expect([e.estado, e.message, e.reintentarDespuesS]).toEqual([429, "cuota", 30]);
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(302, "", { location: "http://interno" })));
    expect((await falla(fetchSeguro("https://api.openai.com/v1/x", { cuerpo: {} }))).message).toMatch(/redirección/);
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(200, "<html>")));
    expect((await falla(fetchSeguro("https://api.openai.com/v1/x", { cuerpo: {} }))).estado).toBe(502);
  });
  it("sin respuesta a tiempo falla con el motivo y el destino, y un corte de red se explica", async () => {
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_ok, no) => init.signal!.addEventListener("abort", () => no(new Error("aborted"))))));
    const e = await falla(fetchSeguro("https://api.openai.com/v1/x", { cuerpo: {}, timeoutMs: 50 }));
    expect(e.estado).toBe(0);
    expect(e.message).toMatch(/Sin respuesta del proveedor: no hubo respuesta en \d+ s.*destino api\.openai\.com/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: new Error("ECONNRESET") }); }));
    expect((await falla(fetchSeguro("https://api.openai.com/v1/x", { cuerpo: {} }))).message).toMatch(/ECONNRESET/);
  });
});
