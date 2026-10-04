import { ClienteGemini, type ClienteLlm, type Parte, type RespuestaLlm } from "./gemini";
import { emitir } from "../traza";
import { ErrorHttp, esClaveInvalida, fetchSeguro, validarBaseUrl, type Fetcher } from "./red-segura";

/** Proveedores admitidos. Todo lo que hable el protocolo de OpenAI entra por «compatible» con su URL base. */
export const TIPOS = ["gemini", "anthropic", "openai", "openrouter", "nvidia", "groq", "deepseek", "mistral", "together", "compatible"] as const;
export type TipoProveedor = (typeof TIPOS)[number];
export type Familia = "gemini" | "anthropic" | "openai";

export const PRESETS: Record<TipoProveedor, { etiqueta: string; familia: Familia; baseUrl: string | null; modoJson?: boolean; ayuda: string }> = {
  gemini: { etiqueta: "Google Gemini", familia: "gemini", baseUrl: null, ayuda: "Clave de Google AI Studio." },
  anthropic: { etiqueta: "Anthropic (Claude: Opus, Sonnet, Haiku)", familia: "anthropic", baseUrl: "https://api.anthropic.com", ayuda: "Clave de console.anthropic.com." },
  openai: { etiqueta: "OpenAI", familia: "openai", baseUrl: "https://api.openai.com/v1", modoJson: true, ayuda: "Clave de platform.openai.com." },
  openrouter: { etiqueta: "OpenRouter (cientos de modelos)", familia: "openai", baseUrl: "https://openrouter.ai/api/v1", modoJson: false, ayuda: "Clave de openrouter.ai; el modelo va como «proveedor/modelo»." },
  nvidia: { etiqueta: "NVIDIA NIM (build.nvidia.com)", familia: "openai", baseUrl: "https://integrate.api.nvidia.com/v1", modoJson: false, ayuda: "Clave de build.nvidia.com (empieza con nvapi-)." },
  groq: { etiqueta: "Groq", familia: "openai", baseUrl: "https://api.groq.com/openai/v1", modoJson: true, ayuda: "Clave de console.groq.com." },
  deepseek: { etiqueta: "DeepSeek", familia: "openai", baseUrl: "https://api.deepseek.com/v1", modoJson: true, ayuda: "Clave de platform.deepseek.com." },
  mistral: { etiqueta: "Mistral AI", familia: "openai", baseUrl: "https://api.mistral.ai/v1", modoJson: true, ayuda: "Clave de console.mistral.ai." },
  together: { etiqueta: "Together AI", familia: "openai", baseUrl: "https://api.together.xyz/v1", modoJson: true, ayuda: "Clave de api.together.ai." },
  compatible: { etiqueta: "Personalizado (cualquier proveedor compatible con OpenAI)", familia: "openai", baseUrl: null, ayuda: "Fireworks, Cerebras, un gateway propio, Ollama o vLLM expuestos por https… Pon su URL base (https, pública)." },
};

export type ConfigProveedor = { tipo: TipoProveedor; baseUrl: string | null; modelo: string; clave: string };

/** URL base efectiva del proveedor, ya validada. Lanza si es inválida. */
export function baseUrlDe(p: Pick<ConfigProveedor, "tipo" | "baseUrl">): string | null {
  const preset = PRESETS[p.tipo];
  if (preset.familia === "gemini") return null;
  // Una URL escrita por el usuario manda sobre la automática; admite pegar la URL de invocación completa que muestran los proveedores.
  const candidata = p.baseUrl?.trim() || preset.baseUrl;
  if (!candidata) throw new Error("Este proveedor necesita una URL base.");
  const v = validarBaseUrl(candidata);
  if (!v.ok) throw new Error(v.motivo);
  return v.url.toString().replace(/\/+$/, "").replace(/\/(chat\/completions|messages)$/, "");
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

  async ping(): Promise<void> {
    await this.fetcher(`${this.base}/v1/messages`, {
      cabeceras: { "x-api-key": this.clave, "anthropic-version": "2023-06-01" },
      cuerpo: { model: this.modelo, max_tokens: 20, messages: [{ role: "user", content: "Responde solo con la palabra OK." }] },
      timeoutMs: 60_000,
    });
  }

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
        emitir("info", "ia", `Petición a ${this.modelo}: tope de salida ${max}, ${o.partes.filter((p) => "inlineData" in p).length} imágenes, salida estructurada por herramienta`);
        r = (await this.fetcher(`${this.base}/v1/messages`, { cabeceras: { "x-api-key": this.clave, "anthropic-version": "2023-06-01" }, cuerpo: cuerpo(max) })) as AnthropicRespuesta;
        break;
      } catch (e) {
        // Los modelos más pequeños tienen un tope de salida menor: se baja el límite y se reintenta.
        // Con saldo justo, Anthropic puede rechazar un tope alto aunque la prueba corta (20 tokens) pase: también se baja.
        if (e instanceof ErrorHttp && e.estado === 400 && /max_tokens|credit balance/i.test(e.message) && max > 4096) continue;
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

const ESCALA_TOKENS = [16000, 8192, 4096];

export type OpcionesOpenAI = { modoJson?: boolean; timeoutMs?: number };

export class ClienteOpenAICompatible implements ClienteLlm {
  private modoJson: boolean;
  private timeoutMs: number;
  constructor(
    private clave: string,
    private modelo: string,
    private base: string,
    private fetcher: Fetcher = fetchSeguro,
    opciones: OpcionesOpenAI = {},
  ) {
    this.modoJson = opciones.modoJson ?? false;
    this.timeoutMs = opciones.timeoutMs ?? 280_000;
  }

  /** Comprobación de conectividad, clave y modelo: la misma petición simple que hace cualquier cliente de chat. */
  async ping(): Promise<void> {
    let param: "max_tokens" | "max_completion_tokens" = "max_tokens";
    for (let i = 0; i < 2; i++) {
      try {
        const r = (await this.fetcher(`${this.base}/chat/completions`, {
          cabeceras: { Authorization: `Bearer ${this.clave}` },
          cuerpo: { model: this.modelo, messages: [{ role: "user", content: "Responde solo con la palabra OK." }], [param]: 1000 },
          timeoutMs: 90_000,
        })) as OpenAiRespuesta;
        if (!Array.isArray(r.choices) || r.choices.length === 0) throw new ErrorHttp(502, "El proveedor respondió sin ninguna elección.");
        return;
      } catch (e) {
        if (e instanceof ErrorHttp && e.estado === 400 && param === "max_tokens" && /max_completion_tokens/i.test(e.message)) {
          param = "max_completion_tokens";
          continue;
        }
        throw e;
      }
    }
  }

  async generarJson(o: { system: string; partes: Parte[]; schema: object }): Promise<RespuestaLlm> {
    const avisos: string[] = [];
    const system = `${o.system}\n\nResponde ÚNICAMENTE con un objeto JSON válido (sin texto antes ni después, sin bloques de código) que cumpla este esquema JSON:\n${JSON.stringify(o.schema)}`;
    const contenido = (conImagenes: boolean) =>
      o.partes
        .filter((p) => conImagenes || "text" in p)
        .map((p) => ("text" in p ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }));
    let conImagenes = o.partes.some((p) => "inlineData" in p);
    let jsonMode = this.modoJson;
    let param: "max_tokens" | "max_completion_tokens" = "max_tokens";
    let nivel = 0;
    let r: OpenAiRespuesta | null = null;
    // Cada rechazo del proveedor ajusta un parámetro distinto; el tope evita bucles.
    for (let intento = 0; intento < 8 && !r; intento++) {
      try {
        emitir("info", "ia", `Intento ${intento + 1} con ${this.modelo}: tope de salida ${ESCALA_TOKENS[nivel]} (${param}), modo JSON ${jsonMode ? "sí" : "no (el esquema va en el prompt)"}, ${conImagenes ? `${o.partes.filter((p) => "inlineData" in p).length} imágenes` : "sin imágenes"}`);
        r = (await this.fetcher(`${this.base}/chat/completions`, {
          cabeceras: { Authorization: `Bearer ${this.clave}` },
          cuerpo: {
            model: this.modelo,
            messages: [{ role: "system", content: system }, { role: "user", content: contenido(conImagenes) }],
            [param]: ESCALA_TOKENS[nivel],
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          },
          timeoutMs: this.timeoutMs,
        })) as OpenAiRespuesta;
      } catch (e) {
        const rechazo = e instanceof ErrorHttp && (e.estado === 400 || e.estado === 422);
        const m = e instanceof ErrorHttp ? e.message : "";
        if (rechazo && jsonMode && /response_format|json_object|json mode|json_schema/i.test(m)) {
          jsonMode = false; // el proveedor no admite el modo JSON: el esquema ya va en el prompt
          emitir("info", "ia", "El proveedor rechazó el modo JSON: se reintenta sin él", m);
          continue;
        }
        if (rechazo && param === "max_tokens" && /max_completion_tokens/i.test(m)) {
          param = "max_completion_tokens"; // los modelos nuevos de OpenAI renombraron el parámetro
          emitir("info", "ia", "El modelo exige max_completion_tokens: se reintenta con ese nombre", m);
          continue;
        }
        if (rechazo && /max_tokens|max_completion_tokens|maximum.*(tokens|length)|too large|exceeds/i.test(m) && nivel < ESCALA_TOKENS.length - 1) {
          nivel++; // el modelo tiene un tope de salida menor
          emitir("info", "ia", `El proveedor rechazó el tope de salida: se baja a ${ESCALA_TOKENS[nivel]}`, m);
          continue;
        }
        if (rechazo && conImagenes && /image|vision|multimodal|multi-modal|modalit|content/i.test(m)) {
          conImagenes = false;
          avisos.push("El modelo no acepta imágenes: el ajuste se hizo sin analizar las fotografías.");
          emitir("info", "ia", "El modelo no acepta imágenes: se reintenta sin las fotografías", m);
          continue;
        }
        throw e;
      }
    }
    const ch = r?.choices?.[0];
    const texto = ch?.message?.content;
    if (!r || !texto) throw new ErrorHttp(502, ch?.finish_reason === "length" ? "El modelo agotó su límite de salida pensando y no llegó a responder (modelo razonador): elige otro modelo." : "El modelo devolvió una respuesta vacía.");
    return { texto: extraerJson(texto), tokensEntrada: r.usage?.prompt_tokens, tokensSalida: r.usage?.completion_tokens, modelo: this.modelo, avisos };
  }
}

/** Construye el cliente adecuado para una configuración guardada. */
export function crearCliente(p: ConfigProveedor, fetcher: Fetcher = fetchSeguro): ClienteLlm {
  const preset = PRESETS[p.tipo];
  if (preset.familia === "gemini") return new ClienteGemini(p.clave, p.modelo);
  const base = baseUrlDe(p)!;
  return preset.familia === "anthropic"
    ? new ClienteAnthropic(p.clave, p.modelo, base, fetcher)
    : new ClienteOpenAICompatible(p.clave, p.modelo, base, fetcher, { modoJson: preset.modoJson });
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

/** La prueba no puede dejar la pantalla colgada: si el proveedor no contesta en el plazo, cuenta como fallo. */
function conLimite<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ErrorHttp(0, `Sin respuesta del proveedor en ${ms / 1000} s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export type ResultadoPrueba = { ok: boolean; ms: number; error?: string; estado?: number };

/** Prueba real de extremo a extremo: una llamada mínima con salida JSON estructurada, como la que hará el agente. */
export async function probarCliente(cliente: ClienteLlm): Promise<ResultadoPrueba> {
  const t0 = Date.now();
  try {
    if (cliente.ping) {
      // Petición simple de chat: comprueba red, clave y modelo. El formato JSON del agente lo validan sus reintentos al ajustar.
      await conLimite(cliente.ping(), 100_000);
      return { ok: true, ms: Date.now() - t0 };
    }
    const r = await conLimite(
      cliente.generarJson({
        system: "Responde solo con el JSON pedido.",
        partes: [{ text: 'Devuelve exactamente este objeto JSON: {"ok": true}' }],
        schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      }),
      100_000,
    );
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

const ORIGEN_CLAVE: { prefijo: string; tipo: TipoProveedor; de: string }[] = [
  { prefijo: "nvapi-", tipo: "nvidia", de: "NVIDIA" },
  { prefijo: "sk-ant-", tipo: "anthropic", de: "Anthropic" },
  { prefijo: "sk-or-", tipo: "openrouter", de: "OpenRouter" },
  { prefijo: "AIza", tipo: "gemini", de: "Google Gemini" },
];

/**
 * Detecta combinaciones que no pueden funcionar y que el proveedor contestaría con un 404/401 confuso: una clave con el prefijo
 * de otro proveedor, o un modelo «marca/nombre» (como los del catálogo de NVIDIA) bajo un proveedor que no usa ese formato.
 * Devuelve el motivo en claro, o null si no hay incoherencia evidente.
 */
export function incoherencia(p: Pick<ConfigProveedor, "tipo" | "modelo" | "clave">): string | null {
  const origen = ORIGEN_CLAVE.find((o) => p.clave.startsWith(o.prefijo));
  if (origen && origen.tipo !== p.tipo) return `Esa clave es de ${origen.de}, pero el proveedor elegido es «${PRESETS[p.tipo].etiqueta}». Elige «${PRESETS[origen.tipo].etiqueta}» en la lista de proveedores. Para usar con ella modelos de otras marcas (p. ej. google/…), el proveedor sigue siendo el de la clave.`;
  if ((p.tipo === "gemini" || p.tipo === "anthropic") && p.modelo.includes("/") && !p.modelo.startsWith("models/"))
    return `«${p.modelo}» es un identificador de catálogo de un intermediario (NVIDIA, OpenRouter…), no de ${PRESETS[p.tipo].etiqueta}. Si la clave es del intermediario, elígelo como proveedor.`;
  return null;
}
