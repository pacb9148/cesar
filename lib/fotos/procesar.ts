import sharp from "sharp";
import { esEdicionNula, type EdicionFoto } from "./recorte";
import { aplicarEdicion } from "./aplicar";
import { CALIDADES, pxDeCalidad, type Calidad } from "./calidad";

/** Foto del caso para un documento. El contenido se pide solo cuando se va a usar (`cargar`), así no se tienen cien fotos en memoria a la vez. */
export type FotoOrigen = { id?: string; recinto: string; buffer?: Buffer; cargar?: () => Promise<Buffer>; edicion?: EdicionFoto | null };

/**
 * Foto lista para incrustar: orientada físicamente por EXIF, sin metadatos (sharp no los conserva, así Word no la gira de nuevo), recortada a
 * la proporción 8,66 × 6,70 cm con Lanczos y comprimida a la calidad elegida. Con la edición del usuario aplicada si la hay.
 * Devuelve null si la imagen está corrupta: el documento sigue y quien llama avisa de cuál se omitió.
 */
export async function fotoFinal(f: FotoOrigen, calidad: Calidad = "300"): Promise<Buffer | null> {
  try {
    const buf = f.buffer ?? (await f.cargar?.());
    if (!buf) return null;
    const px = pxDeCalidad(calidad);
    const q = CALIDADES[calidad].jpeg;
    if (f.edicion && !esEdicionNula(f.edicion)) return await aplicarEdicion(buf, f.edicion, px, q);
    return await sharp(buf).rotate().resize(px.ancho, px.alto, { fit: "cover", position: sharp.strategy.attention, kernel: "lanczos3" }).jpeg({ quality: q }).toBuffer();
  } catch {
    return null;
  }
}
