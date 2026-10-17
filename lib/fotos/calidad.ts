import { FOTO_ALTO_CM, FOTO_ANCHO_CM } from "../domain/constantes";

/** Calidad de las fotos incrustadas en el informe y el anexo: 300 ppp (nítida, pesada) o 150 ppp (liviana, recomendada). El original nunca se toca. */
export type Calidad = "150" | "300";

export const CALIDADES: Record<Calidad, { etiqueta: string; ppp: number; jpeg: number; ayuda: string }> = {
  "150": { etiqueta: "150 ppp (recomendada)", ppp: 150, jpeg: 80, ayuda: "Archivos mucho más livianos, nítidos para leer en pantalla e imprimir." },
  "300": { etiqueta: "300 ppp (máxima)", ppp: 300, jpeg: 85, ayuda: "Máxima nitidez; el informe y el anexo pesan varias veces más." },
};

export const CALIDAD_POR_DEFECTO: Calidad = "150";
export const esCalidad = (x: unknown): x is Calidad => x === "150" || x === "300";

/** Píxeles de la imagen incrustada para la caja de FOTO_ANCHO_CM × FOTO_ALTO_CM (a 300 ppp se mantiene el tamaño de siempre, 1024 px de ancho). */
export function pxDeCalidad(c: Calidad): { ancho: number; alto: number } {
  const ancho = c === "300" ? 1024 : 512;
  return { ancho, alto: Math.round((ancho * FOTO_ALTO_CM) / FOTO_ANCHO_CM) };
}
