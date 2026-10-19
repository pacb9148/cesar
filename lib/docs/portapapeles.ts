export const MENSAJE_PORTAPAPELES = "El navegador no permitió copiar la imagen al portapapeles. Revisa el permiso del sitio para el portapapeles y vuelve a intentarlo.";

/**
 * Copia una imagen PNG al portapapeles, solo al portapapeles: nunca descarga un archivo, para que el usuario decida dónde pegarla. Se entrega la promesa al
 * `ClipboardItem` (en vez de esperar a tener la imagen) para no perder el gesto del usuario mientras se genera. Si el navegador no lo permite, lanza un error con el motivo.
 */
export async function copiarImagen(png: Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error(MENSAJE_PORTAPAPELES);
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } catch (e) {
    if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) throw new Error(MENSAJE_PORTAPAPELES);
    throw e;
  }
}
