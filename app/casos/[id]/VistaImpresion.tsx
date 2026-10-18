"use client";

import { useMemo, useRef, useState } from "react";
import { hojaAHtml, type Orientacion } from "@/lib/docs/impresion-html";
import type { HojaVista } from "@/lib/docs/vista-xlsx";

/** Vista de impresión de una hoja del Excel: cómo saldría en papel (A4, ajustada a lo ancho, con los títulos repetidos en cada página) y botón para imprimirla. */
export default function VistaImpresion({ hoja, alto }: { hoja: HojaVista; alto: string }) {
  const [orientacion, setOrientacion] = useState<Orientacion>("auto");
  const marco = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => hojaAHtml(hoja, { orientacion }), [hoja, orientacion]);

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
        <span className="texto-suave">Hoja A4 ajustada a lo ancho; los títulos de la tabla se repiten en cada página.</span>
      </div>
      <iframe ref={marco} title={`Vista de impresión de ${hoja.nombre}`} srcDoc={html} className="w-full rounded-lg border border-[color:var(--borde)] bg-[#6b7280]" style={{ height: alto }} />
    </div>
  );
}
