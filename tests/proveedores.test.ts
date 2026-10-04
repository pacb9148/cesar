import { describe, it, expect } from "vitest";
import { esDireccionPrivada, validarBaseUrl, ErrorHttp, fetchSeguro, type Fetcher } from "../lib/ia/red-segura";
import { ClienteAnthropic, ClienteOpenAICompatible, PRESETS, TIPOS, baseUrlDe, extraerJson, listarModelos, probarCliente } from "../lib/ia/proveedores";

describe("guarda de red (SSRF)", () => {
  it("rechaza direcciones privadas, internas y de metadatos", () => {
    for (const ip of ["127.0.0.1", "10.10.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])
      expect(esDireccionPrivada(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "104.18.0.1", "2606:4700::1111"]) expect(esDireccionPrivada(ip), ip).toBe(false);
  });
  it("valida la forma de la URL base", () => {
    expect(validarBaseUrl("https://api.openai.com/v1").ok).toBe(true);
    for (const mala of ["http://api.openai.com/v1", "https://user:pw@api.x.com/v1", "https://localhost/v1", "https://10.0.0.5/v1", "https://[::1]/v1", "https://x.internal/v1", "https://api.x.com:8080/v1", "https://api.x.com/v1?k=1", "no es url"])
      expect(validarBaseUrl(mala).ok, mala).toBe(false);
  });
  it("las URL base de los presets son fijas y la personalizada se valida", () => {
    expect(baseUrlDe({ tipo: "nvidia", baseUrl: "https://evil.example" })).toBe("https://integrate.api.nvidia.com/v1");
    expect(baseUrlDe({ tipo: "compatible", baseUrl: "https://api.groq.com/openai/v1/" })).toBe("https://api.groq.com/openai/v1");
    expect(() => baseUrlDe({ tipo: "compatible", baseUrl: "https://169.254.169.254/v1" })).toThrow();
    expect(() => baseUrlDe({ tipo: "compatible", baseUrl: null })).toThrow(/URL base/);
  });
});

describe("catálogo de proveedores", () => {
  it("cada preset trae su URL base https válida y fija", () => {
    for (const t of TIPOS) {
      const p = PRESETS[t];
      if (p.familia === "gemini" || t === "compatible") continue;
      expect(validarBaseUrl(p.baseUrl!).ok, t).toBe(true);
      expect(baseUrlDe({ tipo: t, baseUrl: "https://otra.com/v1" }), t).toBe(p.baseUrl!.replace(/\/+$/, ""));
    }
    expect(baseUrlDe({ tipo: "groq", baseUrl: null })).toBe("https://api.groq.com/openai/v1");
    expect(baseUrlDe({ tipo: "deepseek", baseUrl: null })).toBe("https://api.deepseek.com/v1");
    expect(baseUrlDe({ tipo: "mistral", baseUrl: null })).toBe("https://api.mistral.ai/v1");
    expect(baseUrlDe({ tipo: "together", baseUrl: null })).toBe("https://api.together.xyz/v1");
  });
  it("la salida de red rechaza sin conectar una IP privada escrita, el http y el DNS interno", async () => {
    for (const u of ["https://10.10.0.1/", "https://127.0.0.1:443/", "http://api.openai.com/v1/models", "https://[::1]/"])
      await expect(fetchSeguro(u, { metodo: "GET", timeoutMs: 2000 }), u).rejects.toMatchObject({ estado: 400 });
  });
});

const esquema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
const entrada = { system: "sistema", partes: [{ text: "hola" }, { inlineData: { mimeType: "image/jpeg", data: "AAAA" } }], schema: esquema };

describe("adaptador Anthropic (Claude)", () => {
  it("fuerza la herramienta, envía imágenes y devuelve el JSON de la herramienta", async () => {
    const llamadas: { url: string; cuerpo: Record<string, unknown>; cab?: Record<string, string> }[] = [];
    const f: Fetcher = async (url, o) => {
      llamadas.push({ url, cuerpo: o?.cuerpo as Record<string, unknown>, cab: o?.cabeceras });
      return { content: [{ type: "text", text: "..." }, { type: "tool_use", input: { ok: true } }], stop_reason: "tool_use", usage: { input_tokens: 5, output_tokens: 7 } };
    };
    const r = await new ClienteAnthropic("sk-ant-x", "claude-sonnet-x", "https://api.anthropic.com", f).generarJson(entrada);
    expect(JSON.parse(r.texto)).toEqual({ ok: true });
    expect([r.tokensEntrada, r.tokensSalida]).toEqual([5, 7]);
    expect(llamadas[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(llamadas[0].cab).toMatchObject({ "x-api-key": "sk-ant-x", "anthropic-version": "2023-06-01" });
    expect(llamadas[0].cuerpo.tool_choice).toEqual({ type: "tool", name: "entregar_resultado" });
    const contenido = (llamadas[0].cuerpo.messages as { content: { type: string }[] }[])[0].content;
    expect(contenido.map((c) => c.type)).toEqual(["text", "image"]);
  });
  it("baja max_tokens si el modelo tiene un tope menor", async () => {
    const intentos: number[] = [];
    const f: Fetcher = async (_u, o) => {
      const max = (o?.cuerpo as { max_tokens: number }).max_tokens;
      intentos.push(max);
      if (max > 4096) throw new ErrorHttp(400, "max_tokens: 16000 > 4096, which is the maximum allowed");
      return { content: [{ type: "tool_use", input: { ok: true } }] };
    };
    await new ClienteAnthropic("k", "claude-haiku-x", "https://api.anthropic.com", f).generarJson(entrada);
    expect(intentos).toEqual([16000, 8192, 4096]);
  });
  it("avisa si la respuesta se truncó", async () => {
    const f: Fetcher = async () => ({ content: [{ type: "tool_use", input: {} }], stop_reason: "max_tokens" });
    await expect(new ClienteAnthropic("k", "m", "https://api.anthropic.com", f).generarJson(entrada)).rejects.toThrow(/truncó/);
  });
});

describe("adaptador compatible con OpenAI (OpenAI, OpenRouter, NVIDIA…)", () => {
  const ok = (contenido: string): unknown => ({ choices: [{ message: { content: contenido }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4 } });

  it("manda el esquema en el prompt, el modo JSON y las imágenes; limpia bloques de código", async () => {
    let cuerpo: Record<string, unknown> = {};
    let cab: Record<string, string> | undefined;
    const f: Fetcher = async (_u, o) => {
      cuerpo = o?.cuerpo as Record<string, unknown>;
      cab = o?.cabeceras;
      return ok('Claro:\n```json\n{"ok": true}\n```');
    };
    const r = await new ClienteOpenAICompatible("nvapi-x", "meta/llama", "https://integrate.api.nvidia.com/v1", f, { modoJson: true }).generarJson(entrada);
    expect(JSON.parse(r.texto)).toEqual({ ok: true });
    expect(cab).toMatchObject({ Authorization: "Bearer nvapi-x" });
    expect(cuerpo.response_format).toEqual({ type: "json_object" });
    const msgs = cuerpo.messages as { role: string; content: unknown }[];
    expect(String(msgs[0].content)).toContain('"required":["ok"]');
    expect((msgs[1].content as { type: string }[]).map((c) => c.type)).toEqual(["text", "image_url"]);
  });
  it("reintenta sin modo JSON y sin imágenes cuando el proveedor las rechaza, avisando", async () => {
    const vistos: string[] = [];
    const f: Fetcher = async (_u, o) => {
      const c = o?.cuerpo as { response_format?: unknown; messages: { content: unknown }[] };
      const conImg = Array.isArray(c.messages[1].content) && (c.messages[1].content as { type: string }[]).some((x) => x.type === "image_url");
      vistos.push(`${c.response_format ? "json" : "libre"}/${conImg ? "img" : "texto"}`);
      if (c.response_format) throw new ErrorHttp(400, "response_format json_object is not supported by this model");
      if (conImg) throw new ErrorHttp(400, "This model does not support image input");
      return ok('{"ok": true}');
    };
    const r = await new ClienteOpenAICompatible("k", "m", "https://openrouter.ai/api/v1", f, { modoJson: true }).generarJson(entrada);
    expect(vistos).toEqual(["json/img", "libre/img", "libre/texto"]);
    expect(r.avisos?.[0]).toMatch(/imágenes/);
  });
  it("sin modo JSON (NVIDIA, OpenRouter, personalizados) manda max_tokens y no response_format", async () => {
    let cuerpo: Record<string, unknown> = {};
    const f: Fetcher = async (_u, o) => {
      cuerpo = o?.cuerpo as Record<string, unknown>;
      return ok('{"ok": true}');
    };
    await new ClienteOpenAICompatible("k", "openai/gpt-oss-20b", "https://integrate.api.nvidia.com/v1", f).generarJson(entrada);
    expect(cuerpo.response_format).toBeUndefined();
    expect(cuerpo.max_tokens).toBe(16000);
  });
  it("se adapta al proveedor: renombra max_tokens y baja el tope de salida", async () => {
    const vistos: string[] = [];
    const f: Fetcher = async (_u, o) => {
      const c = o?.cuerpo as Record<string, number>;
      const clave = "max_tokens" in c ? `max_tokens=${c.max_tokens}` : `max_completion_tokens=${c.max_completion_tokens}`;
      vistos.push(clave);
      if ("max_tokens" in c) throw new ErrorHttp(400, "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.");
      if (c.max_completion_tokens > 8192) throw new ErrorHttp(400, "max_completion_tokens is too large: 16000. This model supports at most 8192");
      return ok('{"ok": true}');
    };
    await new ClienteOpenAICompatible("k", "o3", "https://api.openai.com/v1", f).generarJson(entrada);
    expect(vistos).toEqual(["max_tokens=16000", "max_completion_tokens=16000", "max_completion_tokens=8192"]);
  });
  it("avisa cuando un modelo razonador agota su salida sin responder", async () => {
    const f: Fetcher = async () => ({ choices: [{ message: { content: null }, finish_reason: "length" }] });
    await expect(new ClienteOpenAICompatible("k", "razonador", "https://integrate.api.nvidia.com/v1", f).generarJson(entrada)).rejects.toThrow(/razonador/);
  });
  it("ping: petición simple de chat (como cualquier cliente), sin JSON ni esquema", async () => {
    let cuerpo: Record<string, unknown> = {};
    const f: Fetcher = async (_u, o) => {
      cuerpo = o?.cuerpo as Record<string, unknown>;
      return { choices: [{ message: { content: "" }, finish_reason: "length" }] }; // un razonador puede quedarse pensando: 200 basta
    };
    await expect(new ClienteOpenAICompatible("k", "razonador", "https://integrate.api.nvidia.com/v1", f).ping()).resolves.toBeUndefined();
    expect(cuerpo).toMatchObject({ model: "razonador", max_tokens: 1000 });
    expect(cuerpo.response_format).toBeUndefined();
    expect(JSON.stringify(cuerpo)).not.toContain("esquema");
  });
  it("propaga los errores de autenticación sin reintentar", async () => {
    let n = 0;
    const f: Fetcher = async () => {
      n++;
      throw new ErrorHttp(401, "Incorrect API key");
    };
    await expect(new ClienteOpenAICompatible("k", "m", "https://api.openai.com/v1", f).generarJson(entrada)).rejects.toMatchObject({ estado: 401 });
    expect(n).toBe(1);
  });
  it("extraerJson tolera texto alrededor", () => {
    expect(extraerJson('Aquí va: {"a":1} fin')).toBe('{"a":1}');
  });
});

describe("prueba de conexión y lista de modelos", () => {
  it("si el cliente tiene ping, la prueba usa solo el ping", async () => {
    let jsonLlamado = false;
    const c = { ping: async () => {}, generarJson: async () => { jsonLlamado = true; return { texto: "", modelo: "m" }; } };
    expect((await probarCliente(c)).ok).toBe(true);
    expect(jsonLlamado).toBe(false);
    const rota = { ping: async () => { throw new ErrorHttp(404, "model not found"); }, generarJson: async () => ({ texto: "", modelo: "m" }) };
    expect((await probarCliente(rota)).error).toMatch(/404/);
  });
  it("la prueba exige JSON válido con ok=true", async () => {
    const bien = { generarJson: async () => ({ texto: '{"ok":true}', modelo: "m" }) };
    const mal = { generarJson: async () => ({ texto: "hola", modelo: "m" }) };
    const rota = { generarJson: async () => { throw new ErrorHttp(401, "bad key"); } };
    expect((await probarCliente(bien)).ok).toBe(true);
    expect((await probarCliente(mal)).ok).toBe(false);
    const r = await probarCliente(rota);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Credenciales rechazadas/);
  });
  it("lista modelos de cada familia con la autenticación propia", async () => {
    const vistos: { url: string; cab?: Record<string, string> }[] = [];
    const f: Fetcher = async (url, o) => {
      vistos.push({ url, cab: o?.cabeceras });
      if (url.includes("anthropic")) return { data: [{ id: "claude-opus-x", display_name: "Claude Opus" }] };
      if (url.includes("googleapis")) return { models: [{ name: "models/gemini-x", supportedGenerationMethods: ["generateContent"] }, { name: "models/embedding-1", supportedGenerationMethods: ["embedContent"] }] };
      return { data: [{ id: "gpt-x" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }] };
    };
    expect((await listarModelos({ tipo: "anthropic", baseUrl: null, clave: "k" }, f)).map((m) => m.id)).toEqual(["claude-opus-x"]);
    expect((await listarModelos({ tipo: "gemini", baseUrl: null, clave: "k" }, f)).map((m) => m.id)).toEqual(["gemini-x"]);
    expect((await listarModelos({ tipo: "openai", baseUrl: null, clave: "k" }, f)).map((m) => m.id)).toEqual(["gpt-x"]);
    expect(vistos.map((v) => v.url)).toEqual(["https://api.anthropic.com/v1/models?limit=100", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", "https://api.openai.com/v1/models"]);
    expect(vistos[0].cab).toMatchObject({ "x-api-key": "k" });
    expect(vistos[2].cab).toMatchObject({ Authorization: "Bearer k" });
  });
});
