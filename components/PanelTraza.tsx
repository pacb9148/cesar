"use client";

import { useEffect, useRef, useState } from "react";
import type { EventoVista } from "./useFlujo";

const COLOR: Record<EventoVista["tipo"], string> = {
  info: "text-[color:var(--texto)]",
  ok: "text-[color:var(--ok)]",
  error: "text-[color:var(--error)]",
  espera: "text-[color:var(--alerta)]",
};
const MARCA: Record<EventoVista["tipo"], string> = { info: "›", ok: "✓", error: "✗", espera: "…" };
const seg = (t: number) => `${(t / 1000).toFixed(1).padStart(5, " ")} s`;

/** Texto plano del registro, para pegarlo en un informe de error. */
export const registroComoTexto = (e: EventoVista[]) => e.map((x) => `${seg(x.t)}  [${x.paso}] ${MARCA[x.tipo]} ${x.texto}${x.detalle ? `\n          ${x.detalle.replace(/\n/g, "\n          ")}` : ""}`).join("\n");

/** Registro de actividad en vivo de una operación: qué hace, en qué paso va y dónde se detiene. */
export default function PanelTraza({ eventos, cargando, titulo = "Registro de actividad" }: { eventos: EventoVista[]; cargando: boolean; titulo?: string }) {
  const fin = useRef<HTMLDivElement>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    fin.current?.scrollIntoView({ block: "nearest" });
  }, [eventos.length]);
  if (eventos.length === 0 && !cargando) return null;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(registroComoTexto(eventos));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin permiso de portapapeles: el texto sigue seleccionable en pantalla */
    }
  }

  return (
    <section aria-label={titulo} aria-live="polite" className="rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel-2)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[color:var(--texto)]">
          {titulo} {cargando && <span className="font-normal text-[color:var(--alerta)]">· en curso</span>}
        </h3>
        {eventos.length > 0 && (
          <button type="button" className="btn btn-sec !px-2 !py-1 text-xs" onClick={copiar}>
            {copiado ? "Copiado" : "Copiar registro"}
          </button>
        )}
      </div>
      <ol className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
        {eventos.map((e, i) => (
          <li key={i} className={COLOR[e.tipo]}>
            <span className="text-[color:var(--suave)]">{seg(e.t)} </span>
            <span className="rounded bg-[color:var(--panel)] px-1 text-[color:var(--suave)]">{e.paso}</span> {MARCA[e.tipo]} <span className="whitespace-pre-wrap break-words">{e.texto}</span>
            {e.detalle && (
              <details className="ml-6 mt-0.5">
                <summary className="cursor-pointer text-[color:var(--suave)]">ver detalle</summary>
                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-[color:var(--panel)] p-2 text-[color:var(--texto)]">{e.detalle}</pre>
              </details>
            )}
          </li>
        ))}
        {cargando && <li className="text-[color:var(--suave)]">… trabajando</li>}
        <div ref={fin} />
      </ol>
    </section>
  );
}
