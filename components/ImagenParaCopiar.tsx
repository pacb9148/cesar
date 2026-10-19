"use client";

import { useEffect, useState } from "react";

/**
 * Respaldo cuando el navegador no deja copiar la imagen automáticamente: se muestra la imagen ya generada y se pide copiarla con el botón derecho.
 * Funciona en cualquier navegador y no descarga nada.
 */
export default function ImagenParaCopiar({ imagen, alto = "40vh" }: { imagen: Blob; alto?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  // Se lee como data: URL (en un callback) en vez de un blob: URL, que habría que revocar y se rompe al remontar el componente en desarrollo.
  useEffect(() => {
    const lector = new FileReader();
    lector.onload = () => setUrl(String(lector.result));
    lector.readAsDataURL(imagen);
    return () => lector.abort();
  }, [imagen]);
  if (!url) return null;
  return (
    <div className="space-y-1">
      <p role="status" className="aviso aviso-alerta text-sm">
        Tu navegador no deja copiar automáticamente (suele pasar en páginas sin HTTPS). Haz clic derecho sobre la imagen y elige «Copiar imagen».
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- imagen temporal generada en el navegador (blob:), no admite el optimizador de next/image */}
      <img src={url} alt="Imagen lista para copiar" className="block max-w-full overflow-auto rounded border border-[color:var(--borde)] bg-white object-contain" style={{ maxHeight: alto }} />
    </div>
  );
}
