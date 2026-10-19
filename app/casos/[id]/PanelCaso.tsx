"use client";

import { useState } from "react";
import type { Caso, ArchivoMeta } from "@/lib/caso/repositorio";
import type { Reclamacion, SalidaAgente } from "@/lib/domain/tipos";
import { usePasosMenu } from "@/components/Shell";
import type { NombreIcono } from "@/components/Iconos";
import Documentos from "./Documentos";
import Datos from "./Datos";
import Ajuste from "./Ajuste";
import type { ActaInspeccion } from "@/lib/extraccion/acta";
import type { ExtrasMemoria } from "@/lib/caso/partidas-evidencia";
import Informe, { type Gen } from "./Informe";
import Fotos from "./Fotos";
import Descargas from "./Descargas";
import TituloAyuda from "@/components/Ayuda";
import { useFlujo } from "@/components/useFlujo";
import { useRouter } from "next/navigation";

export type AjusteGuardado = { version: number; salida: SalidaAgente; origen: string; creado: string };

const PESTANAS = [
  ["documentos", "Documentos", "carpeta"],
  ["datos", "Datos", "datos"],
  ["fotos", "Fotos", "imagen"],
  ["informe", "Informe", "informe"],
  ["ajuste", "Ajustes", "actividad"],
  ["editar", "Editar y descargar", "lapiz"],
] as const satisfies readonly (readonly [string, string, NombreIcono])[];

export default function PanelCaso(p: { extrasMemoria: ExtrasMemoria; acta: ActaInspeccion | null; propuestaTextos: { caracteristicas: string; evidencia: string } | null; caso: Caso; archivos: ArchivoMeta[]; reclamacion: Reclamacion | null; ajuste: AjusteGuardado | null; ajusteBase: SalidaAgente | null; iaConfigurada: boolean; enInforme: string[]; leyendasGrupos: Record<string, string>; informeAlDia: boolean }) {
  const [tab, setTab] = useState<(typeof PESTANAS)[number][0]>("documentos");
  const router = useRouter();
  const alertas = p.caso.datos.alertas ?? [];
  // La generación se comparte entre «Fotos» (volver a generar tras ordenar) e «Informe».
  const gen = useFlujo<Gen>(`/api/casos/${p.caso.id}/generar`);
  const hayInforme = p.archivos.some((a) => a.tipo === "salida");
  const tieneAjuste = !!p.ajuste || !!p.ajusteBase;
  async function generar() {
    if (hayInforme && !window.confirm("Se rehará todo el informe con la última versión de los datos. Las ediciones que hayas hecho directamente en el Word o el Excel se descartan. ¿Continuar?")) return;
    const r = await gen.ejecutar();
    if (r) router.refresh();
  }
  // Los pasos viven en el menú lateral; aquí solo se trabaja el contenido del paso elegido.
  usePasosMenu(`Siniestro ${p.caso.siniestro}`, PESTANAS.map(([k, etiqueta, icono]) => ({ id: k, etiqueta, icono, activo: tab === k, onClick: () => setTab(k) })));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">
          Siniestro {p.caso.siniestro}
          <span className="texto-suave ml-3 text-base font-normal">{p.caso.datos.asegurado?.nombre}</span>
        </h1>
      </div>
      {alertas.length > 0 && tab !== "documentos" && (
        <div className="aviso aviso-alerta">
          <TituloAyuda titulo={`${alertas.length} aviso(s) del procesamiento`}>
            <ul className="list-disc space-y-1 pl-5">
              {alertas.map((a, i) => (<li key={i}>{a}</li>))}
            </ul>
            <p className="texto-suave text-xs">También los ves en «Documentos» del menú.</p>
          </TituloAyuda>
        </div>
      )}
      {tab === "documentos" && <Documentos {...p} />}
      {tab === "datos" && <Datos caso={p.caso} propuesta={p.propuestaTextos} hayInforme={hayInforme} />}
      {tab === "ajuste" && <Ajuste caso={p.caso} reclamacion={p.reclamacion} ajuste={p.ajuste} ajusteBase={p.ajusteBase} iaConfigurada={p.iaConfigurada} acta={p.acta} extrasMemoria={p.extrasMemoria} />}
      {tab === "fotos" && <Fotos casoId={p.caso.id} archivos={p.archivos} enInforme={p.enInforme} leyendasGrupos={p.leyendasGrupos} alDia={p.informeAlDia} hayInforme={hayInforme} puedeGenerar={tieneAjuste} generando={gen.cargando} onRegenerar={generar} />}
      {tab === "informe" && <Informe caso={p.caso} archivos={p.archivos} tieneAjuste={tieneAjuste} alDia={p.informeAlDia} gen={gen} generar={generar} />}
      {tab === "editar" && <Descargas caso={p.caso} archivos={p.archivos} />}
    </div>
  );
}
