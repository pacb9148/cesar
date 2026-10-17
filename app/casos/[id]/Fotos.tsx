"use client";

import type { ArchivoMeta } from "@/lib/caso/repositorio";
import FotosInforme from "./FotosInforme";
import SugerenciasFotos from "./SugerenciasFotos";

/** Paso «Fotos»: revisión sugerida y orden, selección y leyendas por estancia. Las fotos siguen el orden de las secciones del presupuesto. */
export default function Fotos(p: { casoId: string; archivos: ArchivoMeta[]; enInforme: string[]; leyendasGrupos: Record<string, string>; alDia: boolean; hayInforme: boolean; puedeGenerar: boolean; generando: boolean; onRegenerar: () => Promise<void> }) {
  const fotos = p.archivos.filter((a) => a.tipo === "foto");
  return (
    <section className="space-y-4">
      <SugerenciasFotos casoId={p.casoId} hayFotos={fotos.length > 0} />
      <FotosInforme casoId={p.casoId} fotos={fotos} enInforme={p.enInforme} leyendasGrupos={p.leyendasGrupos} alDia={p.alDia} hayInforme={p.hayInforme} puedeGenerar={p.puedeGenerar} generando={p.generando} onRegenerar={p.onRegenerar} />
    </section>
  );
}
