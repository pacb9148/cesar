"use client";

import { useEffect, useState } from "react";
import VentanaModal from "@/components/VentanaModal";
import type { VistaDocumento as Vista } from "@/lib/caso/edicion-documentos";

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Entregables sencillos: el resumen en texto se edita y se guarda; el ZIP muestra su contenido (se rehace solo al cambiar los demás documentos). */
export default function VistaSimple({ casoId, archivoId, nombre, onCerrar, onGuardado }: { casoId: string; archivoId: string; nombre: string; onCerrar: () => void; onGuardado: () => void }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/casos/${casoId}/archivos/${archivoId}/vista`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Vista & { error?: string };
        if (!vivo) return;
        if (!r.ok) return setError(j.error ?? `Error ${r.status}`);
        setVista(j);
        if (j.tipo === "texto") setTexto(j.contenido);
      })
      .catch(() => vivo && setError("No se pudo cargar el documento."));
    return () => {
      vivo = false;
    };
  }, [casoId, archivoId]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const r = await fetch(`/api/casos/${casoId}/archivos/${archivoId}/vista`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto }) });
    setGuardando(false);
    if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Error ${r.status}`);
    const j = (await r.json().catch(() => null)) as { vista?: Vista } | null;
    if (j?.vista) setVista(j.vista);
    setInfo("Guardado en el documento. El paquete ZIP se rehízo con el texto nuevo.");
    onGuardado();
  }

  const cambiado = vista?.tipo === "texto" && texto !== vista.contenido;

  return (
    <VentanaModal etiqueta={`Documento: ${nombre}`} titulo={nombre} subtitulo={vista?.tipo === "zip" ? "Contenido del paquete (solo lectura)." : "Edita el texto y guarda."} onCerrar={onCerrar}>
      {() => (
        <div className="space-y-3 p-1">
          {!vista && !error && <p role="status" className="texto-suave text-sm">Cargando…</p>}
          {error && <p role="alert" className="aviso aviso-error">{error}</p>}
          {info && !cambiado && <p role="status" className="aviso aviso-ok">{info}</p>}
          {vista?.tipo === "texto" && (
            <>
              <textarea aria-label={`Contenido de ${nombre}`} className="campo min-h-[50vh] w-full font-mono text-sm" value={texto} onChange={(e) => { setTexto(e.target.value); setInfo(null); }} />
              <button type="button" className="btn" disabled={!cambiado || guardando} onClick={() => void guardar()}>
                {guardando ? "Guardando…" : "Guardar cambios"}
              </button>
            </>
          )}
          {vista?.tipo === "zip" && (
            <ul className="divide-y divide-[var(--borde)]">
              {vista.entradas.map((e) => (
                <li key={e.nombre} className="flex justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate">{e.nombre}</span>
                  <span className="texto-suave shrink-0">{kb(e.tamano)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </VentanaModal>
  );
}
