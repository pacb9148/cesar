"use client";

import { useState } from "react";
import type { Caso, ArchivoMeta } from "@/lib/caso/repositorio";
import type { Reclamacion, SalidaAgente } from "@/lib/domain/tipos";
import { usePasosMenu } from "@/components/Shell";
import type { NombreIcono } from "@/components/Iconos";
import Documentos from "./Documentos";
import Datos from "./Datos";
import Ajuste from "./Ajuste";
import Informe from "./Informe";

export type AjusteGuardado = { version: number; salida: SalidaAgente; origen: string; creado: string };

const PESTANAS = [
  ["documentos", "1 · Documentos", "carpeta"],
  ["datos", "2 · Datos", "datos"],
  ["ajuste", "3 · Ajuste", "actividad"],
  ["informe", "4 · Informe", "informe"],
] as const satisfies readonly (readonly [string, string, NombreIcono])[];

export default function PanelCaso(p: { caso: Caso; archivos: ArchivoMeta[]; reclamacion: Reclamacion | null; ajuste: AjusteGuardado | null; iaConfigurada: boolean; enInforme: string[]; leyendasGrupos: Record<string, string>; informeAlDia: boolean }) {
  const [tab, setTab] = useState<(typeof PESTANAS)[number][0]>("documentos");
  const alertas = p.caso.datos.alertas ?? [];
  // Los pasos viven en el menú lateral; aquí solo se trabaja el contenido del paso elegido.
  usePasosMenu(`Siniestro ${p.caso.siniestro}`, PESTANAS.map(([k, etiqueta, icono]) => ({ id: k, etiqueta, icono, activo: tab === k, onClick: () => setTab(k) })));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">
          Siniestro {p.caso.siniestro}
          <span className="texto-suave ml-3 text-base font-normal">{p.caso.datos.asegurado?.nombre}</span>
        </h1>
        <span className="insignia">{p.caso.modo === "reclamacion" ? "Con presupuesto del contratista" : "Pérdida determinada (sin presupuesto)"}</span>
      </div>
      {alertas.length > 0 && tab !== "documentos" && (
        <div className="aviso aviso-alerta">
          <strong>{alertas.length} aviso(s) del procesamiento.</strong> Revísalos en el paso «Documentos» del menú.
        </div>
      )}
      {tab === "documentos" && <Documentos {...p} />}
      {tab === "datos" && <Datos caso={p.caso} />}
      {tab === "ajuste" && <Ajuste caso={p.caso} reclamacion={p.reclamacion} ajuste={p.ajuste} iaConfigurada={p.iaConfigurada} />}
      {tab === "informe" && <Informe caso={p.caso} archivos={p.archivos} tieneAjuste={!!p.ajuste} enInforme={p.enInforme} leyendasGrupos={p.leyendasGrupos} alDia={p.informeAlDia} />}
    </div>
  );
}
