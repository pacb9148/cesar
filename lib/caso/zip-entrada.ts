import PizZip from "pizzip";

export const MAX_ENTRADAS_ZIP = 400;
export const MAX_BYTES_ZIP = 150 * 1024 * 1024;
export const MAX_BYTES_DESCOMPRIMIDO = 600 * 1024 * 1024;
const MAX_BYTES_ARCHIVO = 30 * 1024 * 1024;
const ADMITIDOS = /\.(pdf|docx?|xlsx?|jpe?g|png|webp)$/i;

export type EntradaZip = { nombre: string; ruta: string; contenido: Buffer };
export type ResultadoZip = { entradas: EntradaZip[]; omitidos: { nombre: string; motivo: string }[] };

/** Nombre sin carpetas ni caracteres de control; null si la ruta intenta salir de la carpeta (`..`), es absoluta o es basura del sistema. */
export function rutaSegura(ruta: string): string | null {
  const limpia = ruta.replace(/\\/g, "/");
  if (limpia.startsWith("/") || /^[a-zA-Z]:/.test(limpia)) return null;
  const partes = limpia.split("/").filter(Boolean);
  if (partes.length === 0 || partes.some((p) => p === ".." || p === ".")) return null;
  if (partes.some((p) => p === "__MACOSX" || p.startsWith(".") || /[\u0000-\u001f]/.test(p))) return null;
  if (/^(thumbs\.db|desktop\.ini)$/i.test(partes[partes.length - 1])) return null;
  return partes.join("/");
}

/**
 * Abre un ZIP subido por el usuario con las defensas habituales: cantidad máxima de entradas, tamaño descomprimido total
 * (bomba de compresión), rutas que escapan de la carpeta, basura del sistema y tipos no admitidos. Las carpetas internas
 * se conservan como ruta relativa para que la clasificación por estancia funcione igual que al subir una carpeta.
 */
export function expandirZip(zipBuf: Buffer): ResultadoZip {
  if (zipBuf.length > MAX_BYTES_ZIP) throw new Error("El ZIP supera 150 MB.");
  const zip = new PizZip(zipBuf);
  const archivos = Object.values(zip.files).filter((f) => !f.dir);
  if (archivos.length > MAX_ENTRADAS_ZIP) throw new Error(`El ZIP trae ${archivos.length} archivos (máximo ${MAX_ENTRADAS_ZIP}).`);
  const declarado = archivos.reduce((s, f) => s + ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (declarado > MAX_BYTES_DESCOMPRIMIDO) throw new Error("El contenido del ZIP descomprimido es demasiado grande.");
  const entradas: EntradaZip[] = [];
  const omitidos: ResultadoZip["omitidos"] = [];
  for (const f of archivos) {
    const ruta = rutaSegura(f.name);
    const nombre = f.name.split(/[\\/]/).pop() ?? f.name;
    if (!ruta) {
      omitidos.push({ nombre, motivo: "ruta no permitida" });
      continue;
    }
    if (!ADMITIDOS.test(nombre)) {
      omitidos.push({ nombre, motivo: "tipo no admitido" });
      continue;
    }
    const contenido = Buffer.from(f.asUint8Array());
    if (contenido.length > MAX_BYTES_ARCHIVO) {
      omitidos.push({ nombre, motivo: "supera 30 MB" });
      continue;
    }
    entradas.push({ nombre, ruta, contenido });
  }
  return { entradas, omitidos };
}
