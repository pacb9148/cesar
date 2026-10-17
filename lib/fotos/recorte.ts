import { z } from "zod";
import { FOTO_ALTO_CM, FOTO_ANCHO_CM } from "../domain/constantes";

/**
 * Edición de una fotografía del informe. Se guardan solo parámetros (el original no se toca) y el mismo cálculo lo usan la
 * pantalla de edición y el servidor al generar el documento, para que lo que se ve sea exactamente lo que se inserta.
 */
export const ZOOM_MAX = 16;
/** Giro fino (progresivo) máximo a cada lado, en grados, además de los giros de 90°. */
export const ANGULO_MAX = 45;

export const edicionFotoSchema = z.object({
  /** true = va al informe; sin ninguna marcada, el informe usa solo las fotos del área afectada. */
  incluir: z.boolean().optional(),
  /** true = el usuario la quitó del informe (no entra ni siquiera por la selección automática). */
  excluir: z.boolean().optional(),
  /** Posición de la foto dentro del grupo de su estancia en el informe (1, 2, 3…, de izquierda a derecha). */
  orden: z.number().int().min(1).max(999).optional(),
  leyenda: z.string().trim().max(120).optional(),
  giro: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  /** Giro fino en grados (positivo = a la derecha, en el sentido del reloj), sumado al giro de 90°. Sin valor = 0. */
  angulo: z.number().min(-ANGULO_MAX).max(ANGULO_MAX).optional(),
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

/** Tamaño del lienzo que resulta de girar una imagen `angulo` grados (la caja que contiene la imagen girada). */
export function lienzoRotado(ancho: number, alto: number, angulo = 0): { ancho: number; alto: number } {
  const rad = (angulo * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { ancho: ancho * c + alto * s, alto: ancho * s + alto * c };
}

type EncuadreEntrada = Pick<EdicionFoto, "zoom" | "cx" | "cy"> & { angulo?: number };

/** Mayor ventana con la proporción de la foto que cabe dentro de la imagen (ancho × alto, ya con giros de 90°) girada `angulo` grados, sin esquinas vacías. */
function ventanaMayor(ancho: number, alto: number, angulo: number): { w: number; h: number } {
  const rad = (angulo * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const h = Math.min(ancho / (PROPORCION_FOTO * c + s), alto / (PROPORCION_FOTO * s + c));
  return { w: h * PROPORCION_FOTO, h };
}

/**
 * Ventana de recorte con la proporción de la foto (8,66 × 6,70 cm), ampliada por `zoom`. `ancho`/`alto` son los de la imagen con sus giros de 90° y volteos;
 * el resultado está en píxeles del lienzo girado `angulo` grados (con `angulo` 0, la propia imagen). La ventana nunca sale de la imagen: con giro fino
 * el marco no puede dejar ver las esquinas vacías (se limita su tamaño y su posición).
 */
export function ventanaDeRecorte(ancho: number, alto: number, e: EncuadreEntrada): Ventana {
  const ang = e.angulo ?? 0;
  const rad = (ang * Math.PI) / 180;
  const co = Math.cos(rad);
  const si = Math.sin(rad);
  const c = Math.abs(co);
  const s = Math.abs(si);
  const lienzo = lienzoRotado(ancho, alto, ang);
  const mayor = ventanaMayor(ancho, alto, ang);
  const z = Math.min(ZOOM_MAX, Math.max(1, e.zoom));
  const w = mayor.w / z;
  const h = mayor.h / z;
  // Centro pedido, relativo al centro del lienzo; se pasa al sistema de la imagen sin girar, se limita y se vuelve al lienzo.
  const px = e.cx * lienzo.ancho - lienzo.ancho / 2;
  const py = e.cy * lienzo.alto - lienzo.alto / 2;
  const ax = Math.max(0, ancho / 2 - (w * c + h * s) / 2);
  const ay = Math.max(0, alto / 2 - (w * s + h * c) / 2);
  const qx = Math.min(ax, Math.max(-ax, co * px + si * py));
  const qy = Math.min(ay, Math.max(-ay, -si * px + co * py));
  const rx = co * qx - si * qy;
  const ry = si * qx + co * qy;
  return { x: Math.max(0, Math.min(lienzo.ancho - w, lienzo.ancho / 2 + rx - w / 2)), y: Math.max(0, Math.min(lienzo.alto - h, lienzo.alto / 2 + ry - h / 2)), w, h };
}

/** Centro normalizado (sobre el lienzo girado) que deja la ventana dentro de la imagen (para guardar valores ya corregidos). */
export function centroValido(ancho: number, alto: number, e: EncuadreEntrada): { cx: number; cy: number } {
  const v = ventanaDeRecorte(ancho, alto, e);
  const l = lienzoRotado(ancho, alto, e.angulo ?? 0);
  return { cx: (v.x + v.w / 2) / l.ancho, cy: (v.y + v.h / 2) / l.alto };
}

export const girar = (giro: EdicionFoto["giro"], sentido: 1 | -1): EdicionFoto["giro"] => (((giro + 90 * sentido + 360) % 360) as EdicionFoto["giro"]);

/** Edición sin cambios de imagen (solo, quizá, la marca de inclusión): se trata como foto sin editar, con el recorte automático. */
export const esEdicionNula = (e: EdicionFoto): boolean =>
  e.giro === 0 && (e.angulo ?? 0) === 0 && !e.volteoH && !e.volteoV && e.zoom === 1 && e.cx === 0.5 && e.cy === 0.5 && e.brillo === 0 && e.contraste === 0 && e.saturacion === 0;

/** Tamaño de la ventana de recorte sin ampliar (la mayor con la proporción de la foto que cabe en la imagen). */
export function ventanaBase(ancho: number, alto: number, angulo = 0): { w: number; h: number } {
  const v = ventanaDeRecorte(ancho, alto, { zoom: 1, cx: 0.5, cy: 0.5, angulo });
  return { w: v.w, h: v.h };
}

/**
 * Zoom y centro que encuadran un rectángulo cualquiera (en píxeles del lienzo girado): el marco mantiene su proporción,
 * así que se toma el menor marco con esa proporción que contiene el rectángulo, centrado en él.
 */
export function encuadreDeRectangulo(ancho: number, alto: number, r: { x: number; y: number; w: number; h: number }, angulo = 0): Pick<EdicionFoto, "zoom" | "cx" | "cy"> {
  const base = ventanaBase(ancho, alto, angulo);
  const l = lienzoRotado(ancho, alto, angulo);
  const w = Math.max(r.w, r.h * PROPORCION_FOTO, 1);
  const e = { zoom: Math.min(ZOOM_MAX, Math.max(1, base.w / w)), cx: (r.x + r.w / 2) / l.ancho, cy: (r.y + r.h / 2) / l.alto, angulo };
  const v = centroValido(ancho, alto, e);
  return { zoom: e.zoom, cx: v.cx, cy: v.cy };
}
