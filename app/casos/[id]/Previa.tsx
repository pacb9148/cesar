"use client";

import { useEffect, useState } from "react";
import VentanaModal from "@/components/VentanaModal";
import type { VistaDocumento as Vista } from "@/lib/caso/edicion-documentos";
import HojaExcel from "./HojaExcel";
import VistaImpresion from "./VistaImpresion";
import { Bloques, type Contexto } from "./VistaDocumento";

const SIN_EDICION: Contexto = { alCambiar: () => {}, alFoco: () => {}, alClicFoto: () => {}, alClicImagen: () => {}, eliminados: new Set(), soloLectura: true };

/** Vista previa de solo lectura del Excel de ajuste o del informe con los datos actuales, antes de generar nada. */
export default function Previa({ casoId, cuerpo, titulo, onCerrar }: { casoId: string; cuerpo: unknown; titulo: string; onCerrar: () => void }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoja, setHoja] = useState(0);
  const [impresion, setImpresion] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/casos/${casoId}/previa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Vista & { error?: string };
        if (!vivo) return;
        if (!r.ok) setError(j.error ?? `Error ${r.status}`);
        else setVista(j);
      })
      .catch(() => vivo && setError("No se pudo preparar la vista previa."));
    return () => {
      vivo = false;
    };
  }, [casoId, cuerpo]);

  return (
    <VentanaModal etiqueta={`Vista previa: ${titulo}`} titulo={titulo} subtitulo="Vista previa de solo lectura con los datos actuales: no se guarda ni se genera nada. Se edita en el paso Ajuste y, ya generado, en «Ver y editar»." onCerrar={onCerrar}>
      {({ maximizada }) => (
        <>
          {!vista && !error && <p role="status" className="texto-suave p-4 text-sm">Preparando la vista previa… puede tardar unos segundos.</p>}
          {error && <p role="alert" className="aviso aviso-error">{error}</p>}
          {vista?.tipo === "xlsx" && (
            <>
              <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Hojas del Excel">
                {vista.hojas.map((h, i) => (
                  <button key={h.nombre} type="button" role="tab" aria-selected={hoja === i} className={`btn ${hoja === i ? "" : "btn-sec"} !px-3 !py-1 text-sm`} onClick={() => setHoja(i)}>{h.nombre}</button>
                ))}
                <button type="button" className={`btn ${impresion ? "" : "btn-sec"} ml-auto !px-3 !py-1 text-sm`} aria-pressed={impresion} onClick={() => setImpresion((v) => !v)}>Vista de impresión</button>
              </div>
              {impresion ? <VistaImpresion hoja={vista.hojas[hoja]} alto={maximizada ? "70vh" : "58vh"} /> : <HojaExcel key={vista.hojas[hoja].nombre} h={vista.hojas[hoja]} zoom={1} maximizada={maximizada} soloLectura pendiente={{}} ediciones={new Map()} alEditar={() => {}} alFormato={() => {}} />}
            </>
          )}
          {vista?.tipo === "docx" && (
            <div className={`overflow-auto rounded-lg border border-[color:var(--borde)] bg-[#6b7280] p-3 ${maximizada ? "min-h-0 flex-1" : ""}`} style={{ maxHeight: maximizada ? undefined : "64vh" }}>
              <div className="doc-ed mx-auto" style={{ background: "#fff", color: "#000", maxWidth: 816, padding: "48px 56px", fontFamily: '"Times New Roman", "Liberation Serif", serif', fontSize: 16, lineHeight: 1.3, boxShadow: "0 1px 6px rgba(0,0,0,.4)" }}>
                <Bloques bloques={vista.bloques} c={SIN_EDICION} />
              </div>
            </div>
          )}
        </>
      )}
    </VentanaModal>
  );
}
