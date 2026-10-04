import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
// Se usa el fetch de la propia librería undici junto con su Agent: mezclarlo con el fetch integrado de Node falla por versiones distintas.
import { Agent, fetch as fetchUndici } from "undici";

/**
 * Salida a Internet de las llamadas a proveedores de IA. El usuario puede escribir una URL base propia, y el servidor
 * vive en una red con la base de datos y otros servicios internos: sin esta guarda, esa URL sería un SSRF.
 * Se rechazan direcciones privadas, de loopback y de enlace local, tanto escritas como resueltas por DNS.
 */

const privadaV4 = (ip: string): boolean => {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // enlace local y metadatos de la nube
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast y reservadas
  );
};

export function esDireccionPrivada(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return privadaV4(ip);
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapeada) return privadaV4(mapeada[1]);
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff");
  }
  return true; // lo que no es una IP válida no se acepta
}

const lookupSeguro: typeof dnsLookup = ((host: string, opciones: unknown, cb: unknown) => {
  const callback = (typeof opciones === "function" ? opciones : cb) as (e: Error | null, a?: unknown, f?: number) => void;
  const o = (typeof opciones === "object" && opciones ? opciones : {}) as { all?: boolean };
  dnsLookup(host, { all: true }, (err, direcciones) => {
    if (err) return callback(err);
    const lista = direcciones as { address: string; family: number }[];
    const mala = lista.find((d) => esDireccionPrivada(d.address));
    if (mala || lista.length === 0) return callback(new Error("Dirección de destino no permitida (red privada o interna)"));
    // Se conecta a la IP ya validada: así un DNS que cambia entre la validación y la conexión no sirve de atajo.
    if (o.all) return callback(null, lista);
    callback(null, lista[0].address, lista[0].family);
  });
}) as typeof dnsLookup;

const agente = new Agent({ connect: { lookup: lookupSeguro, timeout: 30_000 }, headersTimeout: 180_000, bodyTimeout: 180_000 });

export type ResultadoUrl = { ok: true; url: URL } | { ok: false; motivo: string };

/** Comprueba la forma de la URL (https, sin credenciales, sin IP privada escrita). La resolución DNS se verifica al conectar. */
export function validarBaseUrl(texto: string): ResultadoUrl {
  let url: URL;
  try {
    url = new URL(texto.trim());
  } catch {
    return { ok: false, motivo: "La URL base no es válida." };
  }
  if (url.protocol !== "https:") return { ok: false, motivo: "La URL base debe usar https." };
  if (url.username || url.password) return { ok: false, motivo: "La URL base no puede llevar usuario ni contraseña." };
  if (url.search || url.hash) return { ok: false, motivo: "La URL base no debe llevar parámetros ni fragmento." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, motivo: "Ese destino es interno y no está permitido." };
  if (isIP(host) && esDireccionPrivada(host)) return { ok: false, motivo: "No se permiten direcciones de red privada." };
  if (url.port && !["443", "8443"].includes(url.port)) return { ok: false, motivo: "Solo se admiten los puertos 443 y 8443." };
  return { ok: true, url };
}

export class ErrorHttp extends Error {
  constructor(
    public estado: number,
    mensaje: string,
    public reintentarDespuesS?: number,
  ) {
    super(mensaje);
  }
}

/** Algunos proveedores (Gemini) responden 400 en vez de 401 cuando la clave no es válida. */
export const esClaveInvalida = (e: ErrorHttp): boolean =>
  e.estado === 401 || e.estado === 403 || (e.estado === 400 && /api key not valid|api_key_invalid|invalid api key|incorrect api key|invalid x-api-key|unauthorized/i.test(e.message));

export type OpcionesFetch = { metodo?: "GET" | "POST"; cabeceras?: Record<string, string>; cuerpo?: unknown; timeoutMs?: number };
export type Fetcher = (url: string, o?: OpcionesFetch) => Promise<unknown>;

const recortar = (s: string) => s.replace(/\s+/g, " ").slice(0, 300);

/** fetch con la guarda de red, sin redirecciones y con tiempo máximo. Lanza ErrorHttp con el estado y el motivo del proveedor. */
export const fetchSeguro: Fetcher = async (url, o = {}) => {
  let r: Awaited<ReturnType<typeof fetchUndici>>;
  try {
    r = await fetchUndici(url, {
      method: o.metodo ?? "POST",
      headers: { "Content-Type": "application/json", ...o.cabeceras },
      body: o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo),
      redirect: "manual",
      signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
      dispatcher: agente,
    });
  } catch (e) {
    const causa = (e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message;
    if (/no permitida/i.test(causa)) throw new ErrorHttp(400, "Destino no permitido (red privada o interna).");
    // Sin respuesta (red, DNS, tiempo agotado): se trata como indisponibilidad momentánea.
    throw new ErrorHttp(0, `Sin respuesta del proveedor: ${recortar(causa)}`);
  }
  const texto = await r.text();
  if (r.status >= 300 && r.status < 400) throw new ErrorHttp(400, "El proveedor respondió con una redirección; no se siguen redirecciones.");
  if (!r.ok) {
    const ra = Number(r.headers.get("retry-after"));
    let detalle = texto;
    try {
      const j = JSON.parse(texto) as { error?: { message?: string } | string; message?: string };
      detalle = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? texto;
    } catch {
      /* texto plano */
    }
    throw new ErrorHttp(r.status, recortar(detalle) || `HTTP ${r.status}`, Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorHttp(502, "El proveedor no devolvió JSON.");
  }
};
