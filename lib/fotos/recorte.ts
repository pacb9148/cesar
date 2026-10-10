import { z } from "zod";
import { FOTO_ALTO_CM, FOTO_ANCHO_CM } from "../domain/constantes";

/**
 * Edición de una fotografía del informe. Se guardan solo parámetros (el original no se toca) y el mismo cálculo lo usan la
 * pantalla de edición y el servidor al generar el documento, para que lo que se ve sea exactamente lo que se inserta.
 */
export const ZOOM_MAX = 16;

export const edicionFotoSchema = z.object({
  /** true = va al informe; sin ninguna marcada, el informe usa solo las fotos del área afectada. */
  incluir: z.boolean().optional(),
  leyenda: z.string().trim().max(120).optional(),
  giro: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  volteoH: z.boolean(),
  volteoV: z.boolean(),
  zoom: z.number().min(1).max(ZOOM_MAX),
  /** Centro del recorte, en proporción (0–1) de la imagen ya girada y volteada. */
  cx: z.number().min(0).max(1),
  cy: z.number().min(0).max(1),
  brillo: z.number().min(-100).max(100),
  contraste: z.number().min(-100).max(100),
  saturacion: z.number().min(-100).max(100),
});
export type EdicionFoto = z.infer<typeof edicionFotoSchema>;

export const EDICION_INICIAL: EdicionFoto = { giro: 0, volteoH: false, volteoV: false, zoom: 1, cx: 0.5, cy: 0.5, brillo: 0, contraste: 0, saturacion: 0 };

export const PROPORCION_FOTO = FOTO_ANCHO_CM / FOTO_ALTO_CM;

/** Tamaño de la imagen después de girarla (los giros de 90° y 270° intercambian ancho y alto). */
export const dimensionesGiradas = (ancho: number, alto: number, giro: EdicionFoto["giro"]) => (giro === 90 || giro === 270 ? { ancho: alto, alto: ancho } : { ancho, alto });

export type Ventana = { x: number; y: number; w: number; h: number };

/** Ventana de recorte (en píxeles de la imagen ya girada) con la proporción de la foto (8,66 × 6,70 cm), ampliada por `zoom` y dentro de la imagen. */
export function ventanaDeRecorte(anchoGirado: number, altoGirado: number, e: Pick<EdicionFoto, "zoom" | "cx" | "cy">): Ventana {
  let w: number;
  let h: number;
  if (anchoGirado / altoGirado > PROPORCION_FOTO) {
    h = altoGirado;
    w = h * PROPORCION_FOTO;
  } else {
    w = anchoGirado;
    h = w / PROPORCION_FOTO;
  }
  const z = Math.min(ZOOM_MAX, Math.max(1, e.zoom));
  w /= z;
  h /= z;
  const x = Math.min(anchoGirado - w, Math.max(0, e.cx * anchoGirado - w / 2));
  const y = Math.min(altoGirado - h, Math.max(0, e.cy * altoGirado - h / 2));
  return { x, y, w, h };
}

/** Centro normalizado que deja la ventana dentro de la imagen (para guardar valores ya corregidos). */
export function centroValido(anchoGirado: number, altoGirado: number, e: Pick<EdicionFoto, "zoom" | "cx" | "cy">): { cx: number; cy: number } {
  const v = ventanaDeRecorte(anchoGirado, altoGirado, e);
  return { cx: (v.x + v.w / 2) / anchoGirado, cy: (v.y + v.h / 2) / altoGirado };
}

export const girar = (giro: EdicionFoto["giro"], sentido: 1 | -1): EdicionFoto["giro"] => (((giro + 90 * sentido + 360) % 360) as EdicionFoto["giro"]);

/** Edición sin cambios de imagen (solo, quizá, la marca de inclusión): se trata como foto sin editar, con el recorte automático. */
export const esEdicionNula = (e: EdicionFoto): boolean =>
  e.giro === 0 && !e.volteoH && !e.volteoV && e.zoom === 1 && e.cx === 0.5 && e.cy === 0.5 && e.brillo === 0 && e.contraste === 0 && e.saturacion === 0;

/** Tamaño de la ventana de recorte sin ampliar (la mayor con la proporción de la foto que cabe en la imagen). */
export function ventanaBase(anchoGirado: number, altoGirado: number): { w: number; h: number } {
  const v = ventanaDeRecorte(anchoGirado, altoGirado, { zoom: 1, cx: 0.5, cy: 0.5 });
  return { w: v.w, h: v.h };
}

/**
 * Zoom y centro que encuadran un rectángulo cualquiera (en píxeles de la imagen girada): el marco mantiene su proporción,
 * así que se toma el menor marco con esa proporción que contiene el rectángulo, centrado en él.
 */
export function encuadreDeRectangulo(anchoGirado: number, altoGirado: number, r: { x: number; y: number; w: number; h: number }): Pick<EdicionFoto, "zoom" | "cx" | "cy"> {
  const base = ventanaBase(anchoGirado, altoGirado);
  const w = Math.max(r.w, r.h * PROPORCION_FOTO, 1);
  const e = { zoom: Math.min(ZOOM_MAX, Math.max(1, base.w / w)), cx: (r.x + r.w / 2) / anchoGirado, cy: (r.y + r.h / 2) / altoGirado };
  return { ...e, ...centroValido(anchoGirado, altoGirado, e) };
}
