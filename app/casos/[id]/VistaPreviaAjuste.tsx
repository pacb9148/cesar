"use client";

import { useState } from "react";

type Vista = {
  modo: string;
  valorUF: number;
  partidasReclamacion: number;
  recintosActa: number;
  fotos: { cantidad: number; kb: number; porRecinto: Record<string, number> };
  pasos: { nombre: string; kb: number; tokens: number; fotos: number }[];
  proveedores: { nombre: string; modelo: string; destino: string; activo: boolean; estado: string; enPausa: boolean; prioridad: number }[];
  muestraDatos: string;
};

const n = (x: number) => x.toLocaleString("es-CL");

/** Lo que se le enviará a la IA, calculado sin llamarla: permite revisar tamaños y proveedores antes de gastar una llamada. */
export default function VistaPreviaAjuste({ casoId }: { casoId: string }) {
  const [v, setV] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function ver() {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/casos/${casoId}/ajustar`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as Vista & { error?: string };
      if (!r.ok) setError(j.error ?? `Error ${r.status}`);
      else setV(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fallo de red");
    } finally {
      setCargando(false);
    }
  }

  const activos = v?.proveedores.filter((p) => p.activo) ?? [];
  return (
    <div className="space-y-2">
      <button type="button" className="btn btn-sec" onClick={ver} disabled={cargando}>
        {cargando ? "Calculando…" : v ? "Actualizar vista previa" : "Ver qué se enviará a la IA"}
      </button>
      {error && <p role="alert" className="aviso aviso-error">{error}</p>}
      {v && (
        <div className="space-y-3 rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel-2)] p-3 text-sm text-[color:var(--texto)]">
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Fila k="Modo" v={v.modo === "reclamacion" ? "Con presupuesto del contratista" : "Pérdida determinada"} />
            <Fila k="Partidas del contratista" v={n(v.partidasReclamacion)} />
            <Fila k="Recintos dañados (acta)" v={n(v.recintosActa)} />
            <Fila k="UF de la fecha" v={String(v.valorUF)} />
            <Fila k="Fotografías (solo en la redacción)" v={`${v.fotos.cantidad} (${n(v.fotos.kb)} KB)`} />
          </dl>
          {Object.keys(v.fotos.porRecinto).length > 0 && (
            <p className="text-xs text-[color:var(--suave)]">Fotos por recinto: {Object.entries(v.fotos.porRecinto).map(([r, c]) => `${r} (${c})`).join(" · ")}</p>
          )}
          <div>
            <p className="mb-1 font-semibold">Peticiones a la IA ({v.pasos.length}; las partidas se clasifican en lotes chicos y el sistema calcula las cifras):</p>
            <ol className="list-decimal space-y-0.5 pl-5 text-xs">
              {v.pasos.map((p, i) => (
                <li key={i}>{p.nombre} — {n(p.kb)} KB, ≈ {n(p.tokens)} tokens{p.fotos ? `, ${p.fotos} fotos` : ""}</li>
              ))}
            </ol>
          </div>
          <div>
            <p className="mb-1 font-semibold">Se intentará con, en este orden:</p>
            {activos.length === 0 ? (
              <p className="aviso aviso-alerta">No hay ningún proveedor activo: agrégalo y pruébalo en Ajustes de IA.</p>
            ) : (
              <ol className="list-decimal space-y-0.5 pl-5">
                {activos.map((p) => (
                  <li key={p.prioridad}>
                    {p.nombre} · <span className="font-mono text-xs">{p.modelo}</span> · <span className="text-[color:var(--suave)]">{p.destino}</span>
                    {p.enPausa && <span className="text-[color:var(--alerta)]"> (en pausa por un fallo reciente; se reintenta igualmente)</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <details>
            <summary className="cursor-pointer text-[color:var(--suave)]">Ver el comienzo de la primera petición (lote de partidas)</summary>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-[color:var(--panel)] p-2 text-xs">{v.muestraDatos}…</pre>
          </details>
        </div>
      )}
    </div>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[color:var(--suave)]">{k}</dt>
      <dd className="font-medium text-[color:var(--texto)]">{v}</dd>
    </div>
  );
}
