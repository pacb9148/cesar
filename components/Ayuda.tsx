"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icono } from "./Iconos";

/**
 * Título con un botón de información (i): el texto explicativo largo no ocupa la pantalla, se abre solo cuando se pide
 * (clic, Enter o Espacio) y se cierra con Escape o al hacer clic fuera.
 */
export default function TituloAyuda({ titulo, nivel = 3, children }: { titulo: string; nivel?: 2 | 3; children: ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierta(false);
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAbierta(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierta]);

  const Titulo = nivel === 2 ? "h2" : "h3";
  return (
    <div ref={caja} className="relative flex items-center gap-2">
      <Titulo className={nivel === 2 ? "text-lg font-semibold" : "font-semibold"}>{titulo}</Titulo>
      <button type="button" className="btn-icono !h-7 !w-7" aria-expanded={abierta} aria-controls={id} aria-label={`Información sobre «${titulo}»`} title="Información" onClick={() => setAbierta((a) => !a)}>
        <Icono nombre="info" tam={18} />
      </button>
      {abierta && (
        <div id={id} role="note" className="panel absolute left-0 top-full z-30 mt-2 w-[min(42rem,90vw)] space-y-2 p-4 text-sm text-[color:var(--texto)] shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}
