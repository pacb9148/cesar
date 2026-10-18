"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Caso } from "@/lib/caso/repositorio";
import { useAccionesMenu } from "@/components/Shell";
import TituloAyuda from "@/components/Ayuda";

/** Los dos textos del informe que salen de la inspección: el usuario los corrige y «Guardar e insertar» los deja en el informe. */
function TextosInforme({ caso, propuesta, hayInforme }: { caso: Caso; propuesta: { caracteristicas: string; evidencia: string }; hayInforme: boolean }) {
  const router = useRouter();
  const [car, setCar] = useState(propuesta.caracteristicas);
  const [evi, setEvi] = useState(propuesta.evidencia);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const cambiado = car !== propuesta.caracteristicas || evi !== propuesta.evidencia;
  // Guardar e insertar también está en el menú lateral; la función se define más abajo (se llama al hacer clic, no al registrar).

  async function guardar() {
    setGuardando(true);
    setMsg(null);
    const r = await fetch(`/api/casos/${caso.id}/textos-informe`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caracteristicas: car, evidencia: evi }) });
    setGuardando(false);
    const j = (await r.json().catch(() => ({}))) as { error?: string; insertado?: boolean; avisos?: string[] };
    if (!r.ok) return setMsg({ tipo: "error", texto: j.error ?? "No se pudo guardar" });
    setMsg({ tipo: "ok", texto: j.insertado ? "Guardado e insertado en el informe (el PDF y el ZIP se rehicieron)." : `Guardado: se usará al generar el informe.${j.avisos?.length ? " " + j.avisos.join(" ") : ""}` });
    router.refresh();
  }

  useAccionesMenu([{ id: "guardar-textos", etiqueta: guardando ? "Guardando…" : "Guardar e insertar en el informe", icono: "guardar", primaria: true, deshabilitado: guardando || (!cambiado && !hayInforme), onClick: () => void guardar() }]);

  return (
    <div className="panel space-y-3 p-5">
      <TituloAyuda titulo="Textos del informe" nivel={2}>
        <p>Salen de la inspección (descripción del inmueble y tabla de daños). Corrígelos si hace falta y usa «Guardar e insertar en el informe»: se guardan y, si el informe ya está generado, se insertan en él sin tocar el resto del documento. En la evidencia, cada línea es una viñeta «Recinto: descripción»; el recinto sale en negrita, cursiva y subrayado, seguido de dos puntos.</p>
      </TituloAyuda>
      <div>
        <label className="etiqueta" htmlFor="texto-caracteristicas">Características del bien en riesgo</label>
        <textarea id="texto-caracteristicas" rows={4} className="campo" value={car} onChange={(e) => setCar(e.target.value)} />
      </div>
      <div>
        <label className="etiqueta" htmlFor="texto-evidencia">Evidencia observada (una viñeta por línea)</label>
        <textarea id="texto-evidencia" rows={8} className="campo" value={evi} onChange={(e) => setEvi(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" disabled={guardando || (!cambiado && !hayInforme)} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar e insertar en el informe"}
        </button>
        <button type="button" className="btn btn-sec" disabled={guardando || !cambiado} onClick={() => { setCar(propuesta.caracteristicas); setEvi(propuesta.evidencia); }}>Deshacer cambios</button>
      </div>
      {msg && <p role={msg.tipo === "error" ? "alert" : "status"} className={`aviso ${msg.tipo === "ok" ? "aviso-ok" : "aviso-error"}`}>{msg.texto}</p>}
    </div>
  );
}

/** El paso «Datos» solo muestra lo que se inserta en el informe y conviene revisar: la descripción del inmueble y la evidencia observada. */
export default function Datos({ caso, propuesta, hayInforme }: { caso: Caso; propuesta: { caracteristicas: string; evidencia: string } | null; hayInforme: boolean }) {
  if (!propuesta) return <p className="panel texto-suave p-5">Primero lee la inspección en el paso «Documentos».</p>;
  return <TextosInforme key={propuesta.caracteristicas + propuesta.evidencia} caso={caso} propuesta={propuesta} hayInforme={hayInforme} />;
}
