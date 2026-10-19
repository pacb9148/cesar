export const MENSAJE_PORTAPAPELES = "El navegador no permitió copiar la imagen automáticamente.";

/** El navegador no dejó copiar: trae la imagen ya generada para que el usuario pueda copiarla con clic derecho → «Copiar imagen». */
export class ErrorPortapapeles extends Error {
  constructor(mensaje: string, readonly imagen?: Blob) {
    super(mensaje);
    this.name = "ErrorPortapapeles";
  }
}

const aDataUrl = (b: Blob) =>
  new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(r.error);
    r.readAsDataURL(b);
  });

/**
 * Copia clásica (`execCommand`) de una imagen seleccionada en un contenedor editable. Es lo que funciona en páginas sin HTTPS, donde el navegador
 * no expone `navigator.clipboard`: la imagen se pega como imagen en Word, Docs, correo y demás editores.
 */
async function copiarSeleccionada(png: Blob): Promise<boolean> {
  const caja = document.createElement("div");
  caja.contentEditable = "true";
  caja.setAttribute("aria-hidden", "true");
  caja.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none;";
  const img = new Image();
  img.src = await aDataUrl(png);
  caja.appendChild(img);
  document.body.appendChild(caja);
  try {
    await img.decode();
    const seleccion = window.getSelection();
    const rango = document.createRange();
    rango.selectNodeContents(caja);
    seleccion?.removeAllRanges();
    seleccion?.addRange(rango);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    window.getSelection()?.removeAllRanges();
    caja.remove();
  }
}

/**
 * Copia una imagen PNG al portapapeles, solo al portapapeles: nunca descarga un archivo, para que el usuario decida dónde pegarla.
 * 1) API estándar `navigator.clipboard` (exige HTTPS), con la promesa entregada al `ClipboardItem` para no perder el gesto del usuario.
 * 2) Si la página no es segura o el navegador la rechaza, copia clásica con la imagen seleccionada.
 * 3) Si tampoco, lanza `ErrorPortapapeles` con la imagen para que la pantalla la muestre y se copie con clic derecho.
 */
export async function copiarImagen(png: Promise<Blob>): Promise<void> {
  if (window.isSecureContext && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      return;
    } catch (e) {
      if (!(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError"))) throw e;
    }
  }
  const imagen = await png;
  if (await copiarSeleccionada(imagen)) return;
  throw new ErrorPortapapeles(MENSAJE_PORTAPAPELES, imagen);
}
