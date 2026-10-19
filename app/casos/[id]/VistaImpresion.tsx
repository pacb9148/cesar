"use client";

import { useMemo, useRef, useState } from "react";
import { hojaAHtml, type Orientacion } from "@/lib/docs/impresion-html";
import { instantaneaPng } from "@/lib/docs/instantanea";
import { copiarImagen, ErrorPortapapeles } from "@/lib/docs/portapapeles";
import ImagenParaCopiar from "@/components/ImagenParaCopiar";
import type { HojaVista } from "@/lib/docs/vista-xlsx";

/** Vista de impresión de una hoja del Excel: cómo saldría en papel (A4, ajustada a lo ancho, con los títulos repetidos en cada página) y botón para imprimirla. */
export default function VistaImpresion({ hoja, alto }: { hoja: HojaVista; alto: string }) {
  const [orientacion, setOrientacion] = useState<Orientacion>("auto");
  const marco = useRef<HTMLIFrameElement>(null);
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [respaldo, setRespaldo] = useState<Blob | null>(null);
  const html = useMemo(() => hojaAHtml(hoja, { orientacion }), [hoja, orientacion]);

  /** Copia al portapapeles una imagen de la hoja completa tal como se imprimirá; si el navegador no deja copiar, la descarga. */
  async function copiarTodo() {
    const doc = marco.current?.contentDocument;
    if (!doc) return;
    setRespaldo(null);
    setEstado({ ok: true, texto: "Generando la imagen…" });
    try {
      const png = instantaneaPng(doc);
      await copiarImagen(png);
      setEstado({ ok: true, texto: `Imagen copiada (${Math.max(1, Math.round((await png).size / 1024))} KB, máximo 512 KB): pégala donde la necesites.` });
    } catch (e) {
      if (e instanceof ErrorPortapapeles && e.imagen) {
        setEstado(null);
        setRespaldo(e.imagen);
        return;
      }
      setEstado({ ok: false, texto: e instanceof Error ? e.message : "No se pudo copiar la imagen." });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-[color:var(--texto)]">
        <label className="flex items-center gap-2">
          Orientación
          <select className="campo !w-auto !px-2 !py-1" value={orientacion} onChange={(e) => setOrientacion(e.target.value as Orientacion)}>
            <option value="auto">Automática</option>
            <option value="horizontal">Horizontal</option>
            <option value="vertical">Vertical</option>
          </select>
        </label>
        <button type="button" className="btn !px-3 !py-1" onClick={() => marco.current?.contentWindow?.print()}>Imprimir</button>
        <button type="button" className="btn btn-sec !px-3 !py-1" onClick={() => void copiarTodo()}>Copiar todo</button>
        <span className="texto-suave">Hoja A4 ajustada a lo ancho; los títulos de la tabla se repiten en cada página.</span>
      </div>
      {estado && <p role={estado.ok ? "status" : "alert"} className={`aviso ${estado.ok ? "aviso-ok" : "aviso-error"} text-sm`}>{estado.texto}</p>}
      {respaldo && <ImagenParaCopiar imagen={respaldo} alto="30vh" />}
      <iframe ref={marco} title={`Vista de impresión de ${hoja.nombre}`} srcDoc={html} className="w-full rounded-lg border border-[color:var(--borde)] bg-[#6b7280]" style={{ height: alto }} />
    </div>
  );
}
