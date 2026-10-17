import sharp from "sharp";
import { FOTO_PX } from "../docs/fotos-xml";
import { ventanaDeRecorte, type EdicionFoto } from "./recorte";

/** Foto final lista para el documento: exactamente FOTO_PX (proporción 8,66 × 6,70 cm), con la edición del usuario aplicada. */
export async function aplicarEdicion(buffer: Buffer, e: EdicionFoto, px: { ancho: number; alto: number } = FOTO_PX, calidadJpeg = 88): Promise<Buffer> {
  // Se orienta por EXIF y se aplica el giro y el volteo; después se recorta sobre esa imagen, igual que en la pantalla de edición.
  let base = sharp(buffer).rotate();
  if (e.giro) base = base.rotate(e.giro);
  if (e.volteoV) base = base.flip();
  if (e.volteoH) base = base.flop();
  const girada = await base.toBuffer({ resolveWithObject: true });
  const v = ventanaDeRecorte(girada.info.width, girada.info.height, e);
  // Giro fino: la ventana ya está calculada dentro de la imagen girada, así que las esquinas vacías del lienzo nunca entran en el recorte.
  const lienzo = e.angulo ? await sharp(girada.data).rotate(e.angulo, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer({ resolveWithObject: true }) : girada;
  let img = sharp(lienzo.data).extract({
    left: Math.max(0, Math.round(v.x)),
    top: Math.max(0, Math.round(v.y)),
    width: Math.max(1, Math.min(lienzo.info.width - Math.round(v.x), Math.round(v.w))),
    height: Math.max(1, Math.min(lienzo.info.height - Math.round(v.y), Math.round(v.h))),
  });
  img = img.resize(px.ancho, px.alto, { fit: "fill", kernel: "lanczos3" });
  if (e.brillo !== 0 || e.saturacion !== 0) img = img.modulate({ brightness: 1 + e.brillo / 100, saturation: 1 + e.saturacion / 100 });
  if (e.contraste !== 0) {
    const a = 1 + e.contraste / 100;
    img = img.linear(a, 128 * (1 - a));
  }
  return img.jpeg({ quality: calidadJpeg }).toBuffer();
}
