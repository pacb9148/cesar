import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";

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

const crearLookupSeguro = (alResolver?: (ips: string[]) => void): typeof dnsLookup => ((host: string, opciones: unknown, cb: unknown) => {
  const callback = (typeof opciones === "function" ? opciones : cb) as (e: Error | null, a?: unknown, f?: number) => void;
  const o = (typeof opciones === "object" && opciones ? opciones : {}) as { all?: boolean };
  dnsLookup(host, { all: true }, (err, direcciones) => {
    if (err) return callback(err);
    const lista = direcciones as { address: string; family: number }[];
    alResolver?.(lista.map((d) => d.address));
    const mala = lista.find((d) => esDireccionPrivada(d.address));
    if (mala || lista.length === 0) return callback(new Error("Dirección de destino no permitida (red privada o interna)"));
    // Se conecta a la IP ya validada: así un DNS que cambia entre la validación y la conexión no sirve de atajo.
    if (o.all) return callback(null, lista);
    callback(null, lista[0].address, lista[0].family);
  });
}) as typeof dnsLookup;

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
const CONECTAR_MS = 20_000;

/**
 * HTTPS con la guarda de red, sin redirecciones y con tiempo máximo. Usa `node:https` (no `undici`): el paquete undici exige
 * una versión de Node reciente y en un servidor con Node más antiguo las conexiones se quedaban colgadas sin error.
 * Lanza ErrorHttp con el estado y el motivo que da el proveedor.
 */
export const fetchSeguro: Fetcher = (urlTexto, o = {}) =>
  new Promise((resolve, reject) => {
    const u = new URL(urlTexto);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (u.protocol !== "https:" || (isIP(host) && esDireccionPrivada(host))) return reject(new ErrorHttp(400, "Destino no permitido (red privada o interna)."));
    const cuerpo = o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo);
    const total = o.timeoutMs ?? 120_000;
    let terminado = false;
    let conectado = false;
    let ips: string[] = [];
    const donde = () => (ips.length ? ` [destino ${host} → ${ips.join(", ")}]` : "");
    const fin = (f: () => void) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      f();
    };
    const req = request(
      {
        protocol: "https:",
        hostname: host,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: o.metodo ?? "POST",
        headers: { "User-Agent": "ajustador-siniestros/1.0", "Content-Type": "application/json", Accept: "application/json", ...(cuerpo ? { "Content-Length": Buffer.byteLength(cuerpo) } : {}), ...o.cabeceras },
        // La IP que valida la guarda es la misma a la que se conecta.
        lookup: crearLookupSeguro((l) => (ips = l)),
      },
      (res) => {
        const trozos: Buffer[] = [];
        let bytes = 0;
        res.on("data", (c: Buffer) => {
          bytes += c.length;
          if (bytes > MAX_RESPUESTA) return req.destroy(new Error("La respuesta del proveedor es demasiado grande"));
          trozos.push(c);
        });
        res.on("error", (e) => fin(() => reject(new ErrorHttp(0, `Sin respuesta del proveedor: ${recortar(e.message)}`))));
        res.on("end", () =>
          fin(() => {
            const texto = Buffer.concat(trozos).toString("utf8");
            const estado = res.statusCode ?? 0;
            if (estado >= 300 && estado < 400) return reject(new ErrorHttp(400, "El proveedor respondió con una redirección; no se siguen redirecciones."));
            if (estado < 200 || estado >= 300) {
              const ra = Number(res.headers["retry-after"]);
              let detalle = texto;
              try {
                const j = JSON.parse(texto) as { error?: { message?: string } | string; message?: string; detail?: string };
                detalle = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? j.detail ?? texto;
              } catch {
                /* texto plano */
              }
              return reject(new ErrorHttp(estado, recortar(detalle) || `HTTP ${estado}`, Number.isFinite(ra) && ra > 0 ? ra : undefined));
            }
            try {
              resolve(JSON.parse(texto));
            } catch {
              reject(new ErrorHttp(502, "El proveedor no devolvió JSON."));
            }
          }),
        );
      },
    );
    // El mensaje distingue «no llegó a conectar» de «conectó y esperó en vano»: son problemas distintos (red vs. modelo lento).
    const temporizador = setTimeout(
      () => req.destroy(new Error(conectado ? `Conectó con el proveedor, envió la petición y no recibió respuesta en ${Math.round(total / 1000)} s (modelo lento o saturado)${donde()}` : `No llegó a conectar en ${Math.round(total / 1000)} s${donde()}`)),
      total,
    );
    req.on("socket", (socket) => {
      // Si no hay conexión TCP+TLS en 20 s se corta ya: no hace falta esperar el tiempo total para saber que el destino no es alcanzable.
      const t = setTimeout(() => req.destroy(new Error(`No se pudo conectar en ${CONECTAR_MS / 1000} s${donde()}`)), CONECTAR_MS);
      socket.once("secureConnect", () => {
        conectado = true;
        clearTimeout(t);
      });
      socket.once("close", () => clearTimeout(t));
    });
    req.on("error", (e) => {
      const msg = (e as { cause?: Error }).cause?.message ?? e.message;
      fin(() => reject(/no permitida/i.test(msg) ? new ErrorHttp(400, "Destino no permitido (red privada o interna).") : new ErrorHttp(0, `Sin respuesta del proveedor: ${recortar(msg)}`)));
    });
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
