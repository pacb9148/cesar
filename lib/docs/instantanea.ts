// Máximo de píxeles por lado que admite un canvas sin fallar en los navegadores habituales.
const LADO_MAXIMO = 15000;

/**
 * Imagen (PNG) de la hoja tal como se imprimirá: toma la hoja ya dibujada en el documento de la vista de impresión, la envuelve en un SVG con
 * `foreignObject` y la pinta en un canvas. No usa librerías ni red: todo el estilo va dentro del propio documento.
 */
export async function instantaneaPng(doc: Document): Promise<Blob> {
  const hoja = doc.querySelector<HTMLElement>(".hoja");
  if (!hoja) throw new Error("No hay hoja que copiar.");
  const ancho = Math.ceil(hoja.offsetWidth);
  const alto = Math.ceil(hoja.offsetHeight);
  const estilo = Array.from(doc.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");
  const contenido = new XMLSerializer().serializeToString(hoja.cloneNode(true));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}"><foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="font:11px Arial,Helvetica,sans-serif;color:#000;background:#fff"><style>${estilo.replace(/&/g, "&amp;").replace(/</g, "&lt;")}\n.hoja{margin:0!important;box-shadow:none!important}</style>${contenido}</div></foreignObject></svg>`;

  const imagen = new Image();
  await new Promise<void>((ok, mal) => {
    imagen.onload = () => ok();
    imagen.onerror = () => mal(new Error("No se pudo dibujar la hoja."));
    imagen.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

  const escala = Math.min(2, LADO_MAXIMO / ancho, LADO_MAXIMO / alto);
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.floor(ancho * escala));
  lienzo.height = Math.max(1, Math.floor(alto * escala));
  const g = lienzo.getContext("2d");
  if (!g) throw new Error("El navegador no permite crear la imagen.");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, lienzo.width, lienzo.height);
  g.scale(escala, escala);
  g.drawImage(imagen, 0, 0, ancho, alto);
  return new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo generar la imagen."))), "image/png"));
}
