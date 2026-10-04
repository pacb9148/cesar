import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { ErrorHttp } from "./red-segura";

export type Parte = { text: string } | { inlineData: { mimeType: string; data: string } };

export type RespuestaLlm = { texto: string; tokensEntrada?: number; tokensSalida?: number; modelo: string; avisos?: string[] };

/** Contrato mínimo con el proveedor de IA: permite probar el flujo con un cliente simulado. */
export interface ClienteLlm {
  generarJson(o: { system: string; partes: Parte[]; schema: object }): Promise<RespuestaLlm>;
}

/** Gemini acepta un subconjunto de JSON Schema: se quitan las palabras clave que no soporta. */
export function esquemaParaGemini(schema: z.ZodType): object {
  const js = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  const limpiar = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(limpiar);
    if (n && typeof n === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (["pattern", "$schema", "additionalProperties", "minItems", "maxItems", "minimum", "exclusiveMinimum", "minLength"].includes(k)) continue;
        o[k] = limpiar(v);
      }
      return o;
    }
    return n;
  };
  return limpiar(js) as object;
}

export class ClienteGemini implements ClienteLlm {
  private ai: GoogleGenAI;
  constructor(
    apiKey = process.env.GEMINI_API_KEY,
    private modelo = process.env.GEMINI_MODEL ?? "gemini-2.5-pro",
  ) {
    if (!apiKey) throw new Error("Falta GEMINI_API_KEY en .env.local");
    this.ai = new GoogleGenAI({ apiKey });
  }
  async generarJson(o: { system: string; partes: Parte[]; schema: object }): Promise<RespuestaLlm> {
    let r;
    try {
      r = await this.ai.models.generateContent({
        model: this.modelo,
        contents: [{ role: "user", parts: o.partes }],
        config: {
          systemInstruction: o.system,
          responseMimeType: "application/json",
          responseJsonSchema: o.schema,
          temperature: 0.1,
        },
      });
    } catch (e) {
      // El SDK lanza ApiError con `status`; sin estado es un fallo de red. Se unifica para que la rotación decida igual que con otros proveedores.
      const err = e as { status?: number; message?: string };
      let detalle = (err.message ?? "Fallo al llamar a Gemini").replace(/\s+/g, " ");
      try {
        // El SDK entrega el cuerpo de error como JSON en el mensaje: se deja solo el texto útil.
        const j = JSON.parse(detalle) as { error?: { message?: string } };
        if (j.error?.message) detalle = j.error.message;
      } catch {
        /* ya es texto */
      }
      throw new ErrorHttp(typeof err.status === "number" ? err.status : 0, detalle.slice(0, 300));
    }
    return {
      texto: r.text ?? "",
      tokensEntrada: r.usageMetadata?.promptTokenCount,
      tokensSalida: r.usageMetadata?.candidatesTokenCount,
      modelo: this.modelo,
    };
  }
}
