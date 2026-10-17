import sharp from "sharp";
import { FOTOS_POR_TABLA } from "../domain/constantes";

/** Foto a analizar: el contenido se pide de a una para no tener todo el caso en memoria. */
export type FotoAnalizable = { id: string; nombre: string; recinto: string; cargar: () => Promise<Buffer> };

export type SugerenciaFoto = {
  recinto: string;
  /** La primera foto de la estancia hace de «vista general de la dependencia». */
  vistaGeneral: string | null;
  duplicadas: { id: string; nombre: string; igualA: string }[];
  borrosas: { id: string; nombre: string }[];
  /** Cantidad de fotos útiles (sin duplicadas ni borrosas) y aviso si es impar o supera el máximo de la cuadrícula. */
  utiles: number;
  avisos: string[];
};

/** dHash de 64 bits: compara el brillo de píxeles vecinos en una miniatura de 9 × 8; fotos casi iguales dan hashes casi iguales. */
export async function huellaDifusa(buf: Buffer): Promise<string> {
  const px = await sharp(buf).rotate().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  return h;
}

export function distanciaHamming(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Varianza del laplaciano sobre una miniatura en grises: baja = poco detalle de borde = foto movida o desenfocada. */
export async function nitidez(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).rotate().grayscale().resize(256, 256, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let suma = 0;
  let suma2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      suma += l;
      suma2 += l * l;
      n++;
    }
  if (n === 0) return 0;
  const media = suma / n;
  return suma2 / n - media * media;
}

const UMBRAL_DUPLICADA = 6; // de 64 bits
const UMBRAL_BORROSA = 40;

/** Sugerencias por estancia. No decide nada: el usuario acepta o descarta. Una foto que no se puede leer se ignora. */
export async function sugerirFotos(fotos: FotoAnalizable[]): Promise<SugerenciaFoto[]> {
  const porRecinto = new Map<string, FotoAnalizable[]>();
  for (const f of fotos) porRecinto.set(f.recinto, [...(porRecinto.get(f.recinto) ?? []), f]);
  const out: SugerenciaFoto[] = [];
  for (const [recinto, lista] of porRecinto) {
    const vistas: { f: FotoAnalizable; h: string }[] = [];
    const duplicadas: SugerenciaFoto["duplicadas"] = [];
    const borrosas: SugerenciaFoto["borrosas"] = [];
    for (const f of lista) {
      try {
        const buf = await f.cargar();
        const h = await huellaDifusa(buf);
        const igual = vistas.find((v) => distanciaHamming(v.h, h) <= UMBRAL_DUPLICADA);
        if (igual) {
          duplicadas.push({ id: f.id, nombre: f.nombre, igualA: igual.f.nombre });
          continue;
        }
        vistas.push({ f, h });
        if ((await nitidez(buf)) < UMBRAL_BORROSA) borrosas.push({ id: f.id, nombre: f.nombre });
      } catch {
        /* imagen ilegible: el informe la omite y avisa; aquí no se sugiere nada sobre ella */
      }
    }
    const utiles = vistas.length - borrosas.length;
    const avisos: string[] = [];
    if (utiles % 2 === 1) avisos.push("Cantidad impar de fotos útiles: la cuadrícula queda con una celda vacía; considera quitar una o agregar otra.");
    if (utiles > FOTOS_POR_TABLA) avisos.push(`Hay más de ${FOTOS_POR_TABLA} fotos útiles: el informe usa varias tablas para esta estancia.`);
    out.push({ recinto, vistaGeneral: lista[0]?.nombre ?? null, duplicadas, borrosas, utiles, avisos });
  }
  return out;
}
