"use client";

import type { ArchivoMeta, Caso } from "@/lib/caso/repositorio";
import { useFlujo } from "@/components/useFlujo";
import PanelTraza from "@/components/PanelTraza";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icono } from "@/components/Iconos";
import { useAccionesMenu } from "@/components/Shell";
import FotosInforme from "./FotosInforme";
import VistaDocumento from "./VistaDocumento";

type Gen = { entregables: { id: string; nombre: string }[]; motorPdf: string; faltantes: string[]; totales: { reclamacionUF: number; ajusteUF: number; indemnizacionUF: number } };

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default function Informe({ caso, archivos, tieneAjuste, enInforme, leyendasGrupos, alDia }: { caso: Caso; archivos: ArchivoMeta[]; tieneAjuste: boolean; enInforme: string[]; leyendasGrupos: Record<string, string>; alDia: boolean }) {
  const router = useRouter();
  const [viendo, setViendo] = useState<{ id: string; nombre: string } | null>(null);
  const gen = useFlujo<Gen>(`/api/casos/${caso.id}/generar`);
  const salidas = archivos.filter((a) => a.tipo === "salida");
  const faltantes = gen.resultado?.faltantes ?? [];
  const hayInforme = salidas.length > 0;
  // Con informe ya generado, el botón solo se activa si cambió algo (archivos, fotos, datos, ajuste o leyendas) desde la última generación.
  const hayCambios = !hayInforme || !alDia;

  async function generar() {
    if (hayInforme && !window.confirm("Se rehará todo el informe con la última versión de los datos. Las ediciones que hayas hecho directamente en el Word o el Excel se descartan. ¿Continuar?")) return;
    const r = await gen.ejecutar();
    if (r) router.refresh();
  }

  // Generar el informe es una acción del menú lateral; activa solo si hay algo nuevo que entregar.
  useAccionesMenu([
    { id: "generar", etiqueta: gen.cargando ? "Generando documentos…" : hayInforme ? "Volver a generar el informe" : "Generar informe", icono: "informe", primaria: true, deshabilitado: gen.cargando || !tieneAjuste || !hayCambios, onClick: () => void generar() },
  ]);

  return (
    <section className="space-y-4">
      <div className="panel space-y-3 p-5">
        <h2 className="text-lg font-semibold">Informe de liquidación</h2>
        <p className="texto-suave text-sm">
          Genera el Excel de ajuste, el informe en Word y PDF (con el modelo y las imágenes de la plantilla), el anexo de fotografías y un paquete ZIP.
          Incluye la captura de agrometeorologia.cl con la estación más cercana al riesgo; eso puede tardar un minuto. Se genera con la acción «Generar informe» del menú lateral.
        </p>
        {!tieneAjuste && <p className="aviso aviso-alerta">Primero ejecuta el ajuste (paso 3).</p>}
      </div>
      <FotosInforme casoId={caso.id} fotos={archivos.filter((a) => a.tipo === "foto")} enInforme={enInforme} leyendasGrupos={leyendasGrupos} />
      {hayInforme && (
        <div className="panel p-5">
          <h3 className="mb-2 font-semibold">Descargas</h3>
          <ul className="divide-y divide-[var(--borde)]">
            {salidas.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{a.nombre} <span className="texto-suave text-xs">· {kb(a.tamano)}</span></span>
                <span className="flex shrink-0 gap-2">
                  {/\.(docx|xlsx)$/i.test(a.nombre) && !/^Anexo/i.test(a.nombre) && (
                    <button type="button" className="btn btn-sec" onClick={() => setViendo({ id: a.id, nombre: a.nombre })} aria-label={`Ver y editar ${a.nombre}`}>
                      <Icono nombre="ojo" /> Ver y editar
                    </button>
                  )}
                  <a className="btn btn-sec" href={`/api/casos/${caso.id}/archivos/${a.id}?descargar=1`}>Descargar</a>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="panel space-y-3 p-5">
        <h3 className="font-semibold">{hayInforme ? "Estado del informe" : "Generación del informe"}</h3>
        <p className="texto-suave text-sm">
          {!hayInforme
            ? "Aún no se ha generado el informe."
            : alDia
              ? "El informe está al día: no hay cambios en archivos, fotos, datos o ajuste desde la última generación."
              : "Hubo cambios en archivos, fotos, datos, leyendas o ajuste desde la última generación: usa «Volver a generar el informe» en el menú lateral para entregar la última versión."}
        </p>
        {gen.error && <p role="alert" className="aviso aviso-error">{gen.error}</p>}
        <PanelTraza eventos={gen.eventos} cargando={gen.cargando} titulo="Qué está generando" />
        {gen.resultado && gen.resultado.motorPdf === "html" && (
          <p className="aviso aviso-alerta">El PDF se hizo con el conversor de respaldo (sin LibreOffice en este servidor): conserva el contenido pero no el formato exacto. El Word sí es el modelo exacto.</p>
        )}
        {gen.resultado && gen.resultado.motorPdf === "ninguno" && (
          <p className="aviso aviso-alerta">Este servidor no tiene LibreOffice ni Chromium: no se generó el PDF (el Word y el Excel sí). Para tener PDF y la captura meteorológica, el administrador debe cambiar el Build Pack del proyecto a Dockerfile.</p>
        )}
        {faltantes.length > 0 && (
          <div className="aviso aviso-alerta">
            <strong>Quedan campos por completar a mano (aparecen en negrita como [FALTA DATO] en el Word):</strong>
            <ul className="mt-1 list-disc pl-5">{faltantes.map((f, i) => (<li key={i}>{f}</li>))}</ul>
          </div>
        )}
      </div>
      {viendo && <VistaDocumento key={viendo.id} casoId={caso.id} archivoId={viendo.id} nombre={viendo.nombre} onCerrar={() => setViendo(null)} onGuardado={() => router.refresh()} />}
    </section>
  );
}
