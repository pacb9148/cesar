"use client";

import type { ArchivoMeta, Caso } from "@/lib/caso/repositorio";
import type { useFlujo } from "@/components/useFlujo";
import PanelTraza from "@/components/PanelTraza";
import { useState } from "react";
import { useAccionesMenu } from "@/components/Shell";
import Previa from "./Previa";
import TituloAyuda from "@/components/Ayuda";
import OpcionesEntrega from "./OpcionesEntrega";

export type Gen = { entregables: { id: string; nombre: string }[]; motorPdf: string; faltantes: string[]; totales: { reclamacionUF: number; ajusteUF: number; indemnizacionUF: number } };

export default function Informe({ caso, archivos, tieneAjuste, alDia, gen, generar }: { caso: Caso; archivos: ArchivoMeta[]; tieneAjuste: boolean; alDia: boolean; gen: ReturnType<typeof useFlujo<Gen>>; generar: () => Promise<void> }) {
  const [previa, setPrevia] = useState<{ tipo: "informe" } | null>(null);
  const salidas = archivos.filter((a) => a.tipo === "salida");
  const faltantes = gen.resultado?.faltantes ?? [];
  const hayInforme = salidas.length > 0;
  // Con informe ya generado, el botón solo se activa si cambió algo (archivos, fotos, datos, ajuste o leyendas) desde la última generación.
  const hayCambios = !hayInforme || !alDia;

  // Generar el informe es una acción del menú lateral; activa solo si hay algo nuevo que entregar.
  useAccionesMenu([
    { id: "previa-informe", etiqueta: "Previsualizar informe", icono: "ojo", deshabilitado: !tieneAjuste, onClick: () => setPrevia({ tipo: "informe" }) },
    { id: "generar", etiqueta: gen.cargando ? "Generando documentos…" : hayInforme ? "Volver a generar el informe" : "Generar informe", icono: "informe", primaria: true, deshabilitado: gen.cargando || !tieneAjuste || !hayCambios, onClick: () => void generar() },
  ]);

  return (
    <section className="space-y-4">
      <div className="panel space-y-3 p-5">
        <TituloAyuda titulo="Informe de liquidación" nivel={2}>
          <p>
          Genera el Excel de ajuste, el informe en Word y PDF (con el modelo y las imágenes de la plantilla), el anexo de fotografías y un paquete ZIP.
          Incluye la captura de agrometeorologia.cl con la estación más cercana al riesgo; eso puede tardar un minuto. Se genera con la acción «Generar informe» del menú lateral.
        </p>
        </TituloAyuda>
        {!tieneAjuste && <p className="aviso aviso-alerta">Primero revisa el ajuste en el paso «Ajustes».</p>}
      </div>
      <OpcionesEntrega casoId={caso.id} entrega={caso.datos.entrega} />
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
        {gen.resultado && !gen.cargando && (
          <p role="status" className="aviso aviso-ok">
            Informe regenerado con todos los cambios.
            {salidas.find((a) => /Paquete completo\.zip$/i.test(a.nombre)) && <> Descarga la última versión: <a className="underline" href={`/api/casos/${caso.id}/archivos/${salidas.find((a) => /Paquete completo\.zip$/i.test(a.nombre))!.id}?descargar=1`}>Paquete completo (ZIP)</a>.</>}
          </p>
        )}
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
      {previa && <Previa casoId={caso.id} cuerpo={previa} titulo="Informe (vista previa)" onCerrar={() => setPrevia(null)} />}
    </section>
  );
}
