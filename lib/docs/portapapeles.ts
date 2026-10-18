/**
 * Copia una imagen PNG al portapapeles. Se entrega la promesa al `ClipboardItem` (en vez de esperar a tener la imagen) para no perder el gesto del
 * usuario mientras se genera; si el navegador no deja copiar imágenes, se descarga como archivo.
 */
export async function copiarImagen(png: Promise<Blob>, nombreArchivo: string): Promise<"copiada" | "descargada"> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return "copiada";
  } catch {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await png);
    a.download = nombreArchivo;
    a.click();
    URL.revokeObjectURL(a.href);
    return "descargada";
  }
}
