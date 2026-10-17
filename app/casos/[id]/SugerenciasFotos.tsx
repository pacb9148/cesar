"use client";

import { useState } from "react";
import type { SugerenciaFoto } from "@/lib/fotos/sugerencias";
import TituloAyuda from "@/components/Ayuda";

/** Revisión opcional de las fotos antes de generar: señala duplicadas, borrosas y estancias con cantidad impar. Solo informa. */
export default function SugerenciasFotos({ casoId, hayFotos }: { casoId: string; hayFotos: boolean }) {
  const [datos, setDatos] = useState<{ total: number; sugerencias: SugerenciaFoto[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analizar() {
    setCargando(true);
    setError(null);
    const r = await fetch(`/api/casos/${casoId}/fotos-sugerencias`, { cache: "no-store" }).catch(() => null);
    setCargando(false);
    if (!r || !r.ok) return setError(((await r?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ?? "No se pudo analizar las fotos");
    setDatos(await r.json());
  }

  const conObservaciones = datos?.sugerencias.filter((s) => s.duplicadas.length || s.borrosas.length || s.avisos.length) ?? [];

  return (
    <div className="panel space-y-3 p-5">
      <TituloAyuda titulo="Revisión de fotos" nivel={3}>
        <p>Analiza las fotografías del caso y sugiere cuáles quitar: duplicadas o casi iguales, borrosas, y estancias con cantidad impar. La primera foto de cada estancia se toma como vista general. Es solo una guía: nada cambia hasta que tú lo decidas en el orden de fotos.</p>
      </TituloAyuda>
      <button type="button" className="btn btn-sec" disabled={!hayFotos || cargando} onClick={() => void analizar()}>
        {cargando ? "Analizando…" : "Analizar fotos"}
      </button>
      {error && <p role="alert" className="aviso aviso-error">{error}</p>}
      {datos && conObservaciones.length === 0 && <p role="status" className="aviso aviso-ok">{datos.total} fotos revisadas: no hay duplicadas, borrosas ni cantidades impares.</p>}
      {conObservaciones.map((s) => (
        <div key={s.recinto} className="space-y-1">
          <h4 className="font-medium">{s.recinto} <span className="texto-suave text-sm">· vista general: {s.vistaGeneral ?? "—"}</span></h4>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {s.duplicadas.map((d) => (<li key={d.id}>«{d.nombre}» es casi igual a «{d.igualA}».</li>))}
            {s.borrosas.map((b) => (<li key={b.id}>«{b.nombre}» parece borrosa.</li>))}
            {s.avisos.map((a) => (<li key={a}>{a}</li>))}
          </ul>
        </div>
      ))}
    </div>
  );
}
