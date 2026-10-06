import sharp from "sharp";
import { FOTO_PX } from "../docs/fotos-xml";
import { ventanaDeRecorte, type EdicionFoto } from "./recorte";

/** Foto final lista para el documento: exactamente FOTO_PX (proporción 7,8 × 6,5 cm), con la edición del usuario aplicada. */
export async function aplicarEdicion(buffer: Buffer, e: EdicionFoto): Promise<Buffer> {
  // Se orienta por EXIF y se aplica el giro y el volteo; después se recorta sobre esa imagen, igual que en la pantalla de edición.
  let base = sharp(buffer).rotate();
  if (e.giro) base = base.rotate(e.giro);
  if (e.volteoV) base = base.flip();
  if (e.volteoH) base = base.flop();
  const girada = await base.toBuffer({ resolveWithObject: true });
  const v = ventanaDeRecorte(girada.info.width, girada.info.height, e);
  let img = sharp(girada.data).extract({
    left: Math.round(v.x),
    top: Math.round(v.y),
    width: Math.max(1, Math.min(girada.info.width - Math.round(v.x), Math.round(v.w))),
    height: Math.max(1, Math.min(girada.info.height - Math.round(v.y), Math.round(v.h))),
  });
  img = img.resize(FOTO_PX.ancho, FOTO_PX.alto, { fit: "fill" });
  if (e.brillo !== 0 || e.saturacion !== 0) img = img.modulate({ brightness: 1 + e.brillo / 100, saturation: 1 + e.saturacion / 100 });
  if (e.contraste !== 0) {
    const a = 1 + e.contraste / 100;
    img = img.linear(a, 128 * (1 - a));
  }
  return img.jpeg({ quality: 88 }).toBuffer();
}
