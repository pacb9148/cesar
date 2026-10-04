import { ClienteGemini, type ClienteLlm, type Parte, type RespuestaLlm } from "./gemini";
import { ErrorHttp, esClaveInvalida, fetchSeguro, validarBaseUrl, type Fetcher } from "./red-segura";

/** Proveedores admitidos. Todo lo que hable el protocolo de OpenAI entra por «compatible» con su URL base. */
export const TIPOS = ["gemini", "anthropic", "openai", "openrouter", "nvidia", "compatible"] as const;
export type TipoProveedor = (typeof TIPOS)[number];
export type Familia = "gemini" | "anthropic" | "openai";

export const PRESETS: Record<TipoProveedor, { etiqueta: string; familia: Familia; baseUrl: string | null; ayuda: string }> = {
  gemini: { etiqueta: "Google Gemini", familia: "gemini", baseUrl: null, ayuda: "Clave de Google AI Studio." },
  anthropic: { etiqueta: "Anthropic (Claude: Opus, Sonnet, Haiku)", familia: "anthropic", baseUrl: "https://api.anthropic.com", ayuda: "Clave de console.anthropic.com." },
  openai: { etiqueta: "OpenAI", familia: "openai", baseUrl: "https://api.openai.com/v1", ayuda: "Clave de platform.openai.com." },
  openrouter: { etiqueta: "OpenRouter (cientos de modelos)", familia: "openai", baseUrl: "https://openrouter.ai/api/v1", ayuda: "Clave de openrouter.ai; el modelo va como «proveedor/modelo»." },
  nvidia: { etiqueta: "NVIDIA NIM (build.nvidia.com)", familia: "openai", baseUrl: "https://integrate.api.nvidia.com/v1", ayuda: "Clave de build.nvidia.com (empieza con nvapi-)." },
  compatible: { etiqueta: "Otro proveedor compatible con OpenAI", familia: "openai", baseUrl: null, ayuda: "Together, Groq, Mistral, DeepSeek, Fireworks, un gateway propio… Pon su URL base (https)." },
};

export type ConfigProveedor = { tipo: TipoProveedor; baseUrl: string | null; modelo: string; clave: string };

/** URL base efectiva del proveedor, ya validada. Lanza si es inválida. */
export function baseUrlDe(p: Pick<ConfigProveedor, "tipo" | "baseUrl">): string | null {
  const preset = PRESETS[p.tipo];
  if (preset.familia === "gemini") return null;
  const candidata = preset.baseUrl ?? p.baseUrl;
  if (!candidata) throw new Error("Este proveedor necesita una URL base.");
  const v = validarBaseUrl(candidata);
  if (!v.ok) throw new Error(v.motivo);
  return v.url.toString().replace(/\/+$/, "");
}

const cabeceraCompleta = (s: string) => s.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

/** Extrae el objeto JSON aunque el modelo lo envuelva en texto o en un bloque de código. */
export function extraerJson(texto: string): string {
  const t = cabeceraCompleta(texto);
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

type AnthropicRespuesta = { content?: { type: string; input?: unknown }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };

export class ClienteAnthropic implements ClienteLlm {
  constructor(
    private clave: string,
    private modelo: string,
    private base = "https://api.anthropic.com",
    private fetcher: Fetcher = fetchSeguro,
  ) {}

  async generarJson(o: { system: string; partes: Parte[]; schema: object }): Promise<RespuestaLlm> {
    const content = o.partes.map((p) =>
      "text" in p ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data } },
    );
    // Salida estructurada por herramienta forzada: es el mecanismo que acepta toda la familia Claude.
    const cuerpo = (max: number) => ({
      model: this.modelo,
      max_tokens: max,
      system: o.system,
      messages: [{ role: "user", content }],
      tools: [{ name: "entregar_resultado", description: "Entrega el resultado final con exactamente la estructura pedida.", input_schema: o.schema }],
      tool_choice: { type: "tool", name: "entregar_resultado" },
    });
    let r: AnthropicRespuesta | null = null;
    for (const max of [16000, 8192, 4096]) {
      try {
        r = (await this.fetcher(`${this.base}/v1/messages`, { cabeceras: { "x-api-key": this.clave, "anthropic-version": "2023-06-01" }, cuerpo: cuerpo(max) })) as AnthropicRespuesta;
        break;
      } catch (e) {
        // Los modelos más pequeños tienen un tope de salida menor: se baja el límite y se reintenta.
        if (e instanceof ErrorHttp && e.estado === 400 && /max_tokens/i.test(e.message) && max > 4096) continue;
        throw e;
      }
    }
    const bloque = r?.content?.find((b) => b.type === "tool_use");
    if (!r || !bloque) throw new ErrorHttp(502, "Claude no devolvió el resultado estructurado.");
    if (r.stop_reason === "max_tokens") throw new ErrorHttp(502, "La respuesta del modelo se truncó por el límite de salida.");
    return { texto: JSON.stringify(bloque.input), tokensEntrada: r.usage?.input_tokens, tokensSalida: r.usage?.output_tokens, modelo: this.modelo };
  }
}

type OpenAiRespuesta = { choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };

export class ClienteOpenAICompatible implements ClienteLlm {
  constructor(
    private clave: string,
    private modelo: string,
    private base: string,
    private fetcher: Fetcher = fetchSeguro,
  ) {}

  async generarJson(o: { system: string; partes: Parte[]; schema: object }): Promise<RespuestaLlm> {
    const avisos: string[] = [];
    const system = `${o.system}\n\nResponde ÚNICAMENTE con un objeto JSON válido (sin texto antes ni después, sin bloques de código) que cumpla este esquema JSON:\n${JSON.stringify(o.schema)}`;
    const contenido = (conImagenes: boolean) =>
      o.partes
        .filter((p) => conImagenes || "text" in p)
        .map((p) => ("text" in p ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }));
    const hayImagenes = o.partes.some((p) => "inlineData" in p);
    const llamar = (conImagenes: boolean, jsonMode: boolean) =>
      this.fetcher(`${this.base}/chat/completions`, {
        cabeceras: { Authorization: `Bearer ${this.clave}` },
        cuerpo: {
          model: this.modelo,
          messages: [{ role: "system", content: system }, { role: "user", content: contenido(conImagenes) }],
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        },
      }) as Promise<OpenAiRespuesta>;

    let conImagenes = hayImagenes;
    let jsonMode = true;
    let r: OpenAiRespuesta | null = null;
    for (let intento = 0; intento < 3 && !r; intento++) {
      try {
        r = await llamar(conImagenes, jsonMode);
      } catch (e) {
        const rechazo = e instanceof ErrorHttp && (e.estado === 400 || e.estado === 422);
        if (rechazo && jsonMode && /response_format|json_object|json mode|json_schema/i.test((e as ErrorHttp).message)) {
          jsonMode = false; // el proveedor no admite el modo JSON: el esquema ya va en el prompt
          continue;
        }
        if (rechazo && conImagenes && /image|vision|multimodal|multi-modal|modalit|content/i.test((e as ErrorHttp).message)) {
          conImagenes = false;
          avisos.push("El modelo no acepta imágenes: el ajuste se hizo sin analizar las fotografías.");
          continue;
        }
        throw e;
      }
    }
    const ch = r?.choices?.[0];
    const texto = ch?.message?.content;
    if (!r || !texto) throw new ErrorHttp(502, ch?.finish_reason === "length" ? "La respuesta del modelo se truncó por el límite de salida." : "El modelo devolvió una respuesta vacía.");
    return { texto: extraerJson(texto), tokensEntrada: r.usage?.prompt_tokens, tokensSalida: r.usage?.completion_tokens, modelo: this.modelo, avisos };
  }
}

/** Construye el cliente adecuado para una configuración guardada. */
export function crearCliente(p: ConfigProveedor, fetcher: Fetcher = fetchSeguro): ClienteLlm {
  const f = PRESETS[p.tipo].familia;
  if (f === "gemini") return new ClienteGemini(p.clave, p.modelo);
  const base = baseUrlDe(p)!;
  return f === "anthropic" ? new ClienteAnthropic(p.clave, p.modelo, base, fetcher) : new ClienteOpenAICompatible(p.clave, p.modelo, base, fetcher);
}

export type ModeloDisponible = { id: string; nombre: string };

/** Pregunta al propio proveedor qué modelos admite esa clave: el selector nunca ofrece identificadores inventados. */
export async function listarModelos(p: Pick<ConfigProveedor, "tipo" | "baseUrl" | "clave">, fetcher: Fetcher = fetchSeguro): Promise<ModeloDisponible[]> {
  const fam = PRESETS[p.tipo].familia;
  if (fam === "gemini") {
    const j = (await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { metodo: "GET", cabeceras: { "x-goog-api-key": p.clave } })) as {
      models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    };
    return (j.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/i.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), nombre: m.displayName ?? m.name }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  const base = baseUrlDe({ tipo: p.tipo, baseUrl: p.baseUrl })!;
  if (fam === "anthropic") {
    const j = (await fetcher(`${base}/v1/models?limit=100`, { metodo: "GET", cabeceras: { "x-api-key": p.clave, "anthropic-version": "2023-06-01" } })) as { data?: { id: string; display_name?: string }[] };
    return (j.data ?? []).map((m) => ({ id: m.id, nombre: m.display_name ?? m.id }));
  }
  const j = (await fetcher(`${base}/models`, { metodo: "GET", cabeceras: { Authorization: `Bearer ${p.clave}` } })) as { data?: { id: string; name?: string }[] };
  const ruido = /embed|whisper|tts|dall-e|moderation|rerank|davinci|babbage|transcribe|image|audio|realtime/i;
  return (j.data ?? [])
    .filter((m) => !ruido.test(m.id))
    .map((m) => ({ id: m.id, nombre: m.name ?? m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export type ResultadoPrueba = { ok: boolean; ms: number; error?: string; estado?: number };

/** Prueba real de extremo a extremo: una llamada mínima con salida JSON estructurada, como la que hará el agente. */
export async function probarCliente(cliente: ClienteLlm): Promise<ResultadoPrueba> {
  const t0 = Date.now();
  try {
    const r = await cliente.generarJson({
      system: "Responde solo con el JSON pedido.",
      partes: [{ text: 'Devuelve exactamente este objeto JSON: {"ok": true}' }],
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });
    const j = JSON.parse(extraerJson(r.texto)) as { ok?: unknown };
    if (j.ok !== true) return { ok: false, ms: Date.now() - t0, error: "El modelo respondió, pero no cumplió el formato JSON pedido." };
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    if (e instanceof ErrorHttp) return { ok: false, ms: Date.now() - t0, estado: e.estado, error: mensajeAmable(e) };
    return { ok: false, ms: Date.now() - t0, error: e instanceof SyntaxError ? "El modelo no devolvió JSON válido." : e instanceof Error ? e.message.slice(0, 250) : "Error desconocido" };
  }
}

export function mensajeAmable(e: ErrorHttp): string {
  if (esClaveInvalida(e)) return `Credenciales rechazadas (${e.estado}): revisa la clave y sus permisos. ${e.message}`.slice(0, 300);
  if (e.estado === 410) return `Modelo retirado por el proveedor (410): elige otro de la lista de modelos disponibles. ${e.message}`.slice(0, 300);
  if (e.estado === 404) return `Modelo o ruta no encontrados (404): revisa el nombre del modelo y la URL base. ${e.message}`.slice(0, 300);
  if (e.estado === 429) return `Límite de uso o saldo agotado (429). ${e.message}`.slice(0, 300);
  if (e.estado === 0) return e.message;
  return `Error ${e.estado}: ${e.message}`.slice(0, 300);
}
