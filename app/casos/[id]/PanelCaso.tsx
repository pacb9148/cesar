"use client";

import { useState } from "react";
import type { Caso, ArchivoMeta } from "@/lib/caso/repositorio";
import type { Reclamacion, SalidaAgente } from "@/lib/domain/tipos";
import Documentos from "./Documentos";
import Datos from "./Datos";
import Ajuste from "./Ajuste";
import Informe from "./Informe";

export type AjusteGuardado = { version: number; salida: SalidaAgente; origen: string; creado: string };

const PESTANAS = [
  ["documentos", "1 · Documentos"],
  ["datos", "2 · Datos"],
  ["ajuste", "3 · Ajuste"],
  ["informe", "4 · Informe"],
] as const;

export default function PanelCaso(p: { caso: Caso; archivos: ArchivoMeta[]; reclamacion: Reclamacion | null; ajuste: AjusteGuardado | null }) {
  const [tab, setTab] = useState<(typeof PESTANAS)[number][0]>("documentos");
  const alertas = p.caso.datos.alertas ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">
          Siniestro {p.caso.siniestro}
          <span className="texto-suave ml-3 text-base font-normal">{p.caso.datos.asegurado?.nombre}</span>
        </h1>
        <span className="insignia">{p.caso.modo === "reclamacion" ? "Con presupuesto del contratista" : "Pérdida determinada (sin presupuesto)"}</span>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Pasos del caso">
        {PESTANAS.map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} aria-current={tab === k} className={`btn ${tab === k ? "" : "btn-sec"}`}>
            {t}
          </button>
        ))}
      </nav>
      {alertas.length > 0 && tab !== "documentos" && (
        <div className="aviso aviso-alerta">
          <strong>{alertas.length} aviso(s) del procesamiento.</strong> Revísalos en el paso 1.
        </div>
      )}
      {tab === "documentos" && <Documentos {...p} />}
      {tab === "datos" && <Datos caso={p.caso} />}
      {tab === "ajuste" && <Ajuste caso={p.caso} reclamacion={p.reclamacion} ajuste={p.ajuste} />}
      {tab === "informe" && <Informe caso={p.caso} archivos={p.archivos} tieneAjuste={!!p.ajuste} />}
    </div>
  );
}
