"use client";

import { useState, type ReactNode } from "react";
import { BotonIcono } from "./Iconos";

export type EstadoVentana = { maximizada: boolean };

/**
 * Ventana flotante de los editores: se puede minimizar (queda una barra abajo a la derecha con todo su contenido intacto),
 * maximizar a pantalla completa y restaurar, o cerrar. Los editores reciben `maximizada` para aprovechar el espacio.
 */
export default function VentanaModal({
  titulo,
  subtitulo,
  etiqueta,
  acciones,
  onCerrar,
  ancho = "max-w-5xl",
  nivel = 50,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  etiqueta: string;
  acciones?: ReactNode;
  onCerrar: () => void;
  ancho?: string;
  nivel?: number;
  children: (e: EstadoVentana) => ReactNode;
}) {
  const [modo, setModo] = useState<"normal" | "max" | "min">("normal");
  const maximizada = modo === "max";

  const controles = (
    <span className="flex items-center gap-1" role="group" aria-label="Controles de la ventana">
      {modo !== "min" && <BotonIcono icono="minimizar" etiqueta="Minimizar" onClick={() => setModo("min")} />}
      <BotonIcono icono={maximizada ? "restaurar" : "maximizar"} etiqueta={maximizada ? "Restaurar tamaño" : "Maximizar (pantalla completa)"} onClick={() => setModo(maximizada ? "normal" : "max")} />
      <BotonIcono icono="cerrar" etiqueta="Cerrar" onClick={onCerrar} />
    </span>
  );

  return (
    <>
      {modo === "min" && (
        <div role="region" aria-label={`${etiqueta} (minimizada)`} className="panel fixed bottom-3 right-3 flex max-w-[92vw] items-center gap-3 p-2 shadow-lg" style={{ zIndex: nivel + 1 }}>
          <span className="max-w-[40vw] truncate text-sm font-semibold text-[color:var(--texto)]">{titulo}</span>
          <span className="flex items-center gap-1">
            <BotonIcono icono="restaurar" etiqueta="Restaurar la ventana" onClick={() => setModo("normal")} />
            <BotonIcono icono="maximizar" etiqueta="Maximizar (pantalla completa)" onClick={() => setModo("max")} />
            <BotonIcono icono="cerrar" etiqueta="Cerrar" onClick={onCerrar} />
          </span>
        </div>
      )}
      {/* El contenido sigue montado al minimizar: no se pierde nada de lo editado. */}
      <div style={{ zIndex: nivel, display: modo === "min" ? "none" : undefined }} className={`fixed inset-0 flex items-center justify-center bg-black/70 ${maximizada ? "p-0" : "p-2 sm:p-4"}`} onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
        <div role="dialog" aria-modal="true" aria-label={etiqueta} className={`panel flex w-full flex-col gap-3 overflow-hidden p-3 sm:p-4 ${maximizada ? "h-full max-w-none !rounded-none" : `max-h-full ${ancho}`}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-[color:var(--texto)]">{titulo}</h2>
              {subtitulo && <p className="text-xs text-[color:var(--suave)]">{subtitulo}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {acciones}
              <span className="mx-1 h-6 w-px bg-[color:var(--borde)]" aria-hidden="true" />
              {controles}
            </div>
          </div>
          {children({ maximizada })}
        </div>
      </div>
    </>
  );
}
