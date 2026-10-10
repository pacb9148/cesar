import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { emitir, vistaPrevia } from "../traza";

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

const MAX_RESPUESTA = 20 * 1024 * 1024;
const LATIDO_MS = 10_000;

const kb = (n: number) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;

/** Resuelve el DNS y rechaza el destino si alguna de sus direcciones es privada, de loopback o de metadatos. */
async function resolverSeguro(host: string): Promise<string[]> {
  if (isIP(host)) {
    if (esDireccionPrivada(host)) throw new ErrorHttp(400, "Destino no permitido (red privada o interna).");
    return [host];
  }
  const lista = await new Promise<{ address: string }[]>((ok, fallo) => dnsLookup(host, { all: true }, (e, d) => (e ? fallo(e) : ok(d as { address: string }[]))));
  if (lista.length === 0 || lista.some((d) => esDireccionPrivada(d.address))) throw new ErrorHttp(400, "Destino no permitido (red privada o interna).");
  return lista.map((d) => d.address);
}

/**
 * HTTPS con la guarda de red, sin redirecciones y con tiempo máximo. Usa el `fetch` integrado de Node, el mismo que usan el SDK de
 * Gemini y cualquier otro cliente de estos proveedores: con una petición `node:https` hecha a mano, la plataforma conectaba y enviaba
 * pero nunca recibía respuesta de NVIDIA y otros, mientras la misma clave funcionaba en otras aplicaciones. La guarda valida el
 * destino (https, puerto, DNS sin direcciones privadas) justo antes de conectar. Cada fase se informa a la traza de la operación en curso.
 * Lanza ErrorHttp con el estado y el motivo que da el proveedor.
 */
export const fetchSeguro: Fetcher = async (urlTexto, o = {}) => {
  const u = new URL(urlTexto);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (u.protocol !== "https:" || (isIP(host) && esDireccionPrivada(host))) throw new ErrorHttp(400, "Destino no permitido (red privada o interna).");
  if (u.port && !["443", "8443"].includes(u.port)) throw new ErrorHttp(400, "Solo se admiten los puertos 443 y 8443.");
  const cuerpo = o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo);
  const metodo = o.metodo ?? "POST";
  const total = o.timeoutMs ?? 120_000;
  const ini = Date.now();
  const ms = () => Date.now() - ini;
  emitir("info", "red", `${metodo} ${u.origin}${u.pathname}`, cuerpo ? JSON.stringify(vistaPrevia(o.cuerpo), null, 2) : undefined);

  let ips: string[];
  try {
    ips = await resolverSeguro(host);
  } catch (e) {
    if (e instanceof ErrorHttp) throw e;
    throw new ErrorHttp(0, `Sin respuesta del proveedor: no se pudo resolver ${host} (${recortar(e instanceof Error ? e.message : String(e))})`);
  }
  emitir("ok", "red", `DNS resuelto (${ms()} ms): ${ips.join(", ")}`);
  const donde = ` [destino ${host} → ${ips.join(", ")}]`;

  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), total);
  const latido = setInterval(() => emitir("espera", "red", `Esperando la respuesta del proveedor… ${Math.round(ms() / 1000)} s`), LATIDO_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${u.origin}${u.pathname}${u.search}`, {
        method: metodo,
        redirect: "manual",
        signal: control.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "ajustador-siniestros/1.0", ...o.cabeceras },
        body: cuerpo,
      });
    } catch (e) {
      const causa = (e as { cause?: Error }).cause?.message ?? (e instanceof Error ? e.message : String(e));
      if (control.signal.aborted) throw new ErrorHttp(0, `Sin respuesta del proveedor: no hubo respuesta en ${Math.round(total / 1000)} s (modelo lento, saturado o sin conexión)${donde}`);
      emitir("error", "red", `Fallo de red tras ${(ms() / 1000).toFixed(1)} s: ${recortar(causa)}`);
      throw new ErrorHttp(0, `Sin respuesta del proveedor: ${recortar(causa)}${donde}`);
    }
    emitir("ok", "red", `Respuesta del proveedor: HTTP ${res.status} a los ${(ms() / 1000).toFixed(1)} s (llegaron las cabeceras)`);
    let texto: string;
    try {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_RESPUESTA) throw new ErrorHttp(502, "La respuesta del proveedor es demasiado grande");
      texto = buf.toString("utf8");
    } catch (e) {
      if (e instanceof ErrorHttp) throw e;
      throw new ErrorHttp(0, `Sin respuesta del proveedor: se cortó la respuesta (${control.signal.aborted ? `más de ${Math.round(total / 1000)} s` : recortar(e instanceof Error ? e.message : String(e))})${donde}`);
    }
    const estado = res.status;
    emitir(estado >= 200 && estado < 300 ? "ok" : "error", "red", `Cuerpo recibido: ${kb(texto.length)} en ${(ms() / 1000).toFixed(1)} s`, texto.length < 1500 ? texto : `${texto.slice(0, 1500)}…`);
    if (estado >= 300 && estado < 400) throw new ErrorHttp(400, "El proveedor respondió con una redirección; no se siguen redirecciones.");
    if (estado < 200 || estado >= 300) {
      const ra = Number(res.headers.get("retry-after"));
      let detalle = texto;
      try {
        const j = JSON.parse(texto) as { error?: { message?: string } | string; message?: string; detail?: string };
        detalle = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? j.detail ?? texto;
      } catch {
        /* texto plano */
      }
      throw new ErrorHttp(estado, recortar(detalle) || `HTTP ${estado}`, Number.isFinite(ra) && ra > 0 ? ra : undefined);
    }
    try {
      return JSON.parse(texto);
    } catch {
      throw new ErrorHttp(502, "El proveedor no devolvió JSON.");
    }
  } finally {
    clearTimeout(temporizador);
    clearInterval(latido);
  }
};
