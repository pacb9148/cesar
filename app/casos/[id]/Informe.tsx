"use client";

import type { ArchivoMeta, Caso } from "@/lib/caso/repositorio";
import { useAccion } from "@/components/useAccion";

type Gen = { entregables: { id: string; nombre: string }[]; motorPdf: string; faltantes: string[]; totales: { reclamacionUF: number; ajusteUF: number; indemnizacionUF: number } };

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default function Informe({ caso, archivos, tieneAjuste }: { caso: Caso; archivos: ArchivoMeta[]; tieneAjuste: boolean }) {
  const gen = useAccion<Gen>(`/api/casos/${caso.id}/generar`);
  const salidas = archivos.filter((a) => a.tipo === "salida");
  const faltantes = gen.resultado?.faltantes ?? [];
  return (
    <section className="space-y-4">
      <div className="panel space-y-3 p-5">
        <h2 className="text-lg font-semibold">Informe de liquidación</h2>
        <p className="texto-suave text-sm">
          Genera el Excel de ajuste, el informe en Word y PDF (con el modelo y las imágenes de la plantilla), el anexo de fotografías y un paquete ZIP.
          Incluye la captura de agrometeorologia.cl con la estación más cercana al riesgo; eso puede tardar un minuto.
        </p>
        <button className="btn" disabled={gen.cargando || !tieneAjuste} onClick={() => gen.ejecutar()}>
          {gen.cargando ? "Generando documentos…" : salidas.length ? "Volver a generar" : "Generar informe"}
        </button>
        {!tieneAjuste && <p className="aviso aviso-alerta">Primero ejecuta el ajuste (paso 3).</p>}
        {gen.error && <p role="alert" className="aviso aviso-error">{gen.error}</p>}
        {gen.resultado && gen.resultado.motorPdf === "html" && (
          <p className="aviso aviso-alerta">El PDF se hizo con el conversor de respaldo (sin LibreOffice en este servidor): conserva el contenido pero no el formato exacto. El Word sí es el modelo exacto.</p>
        )}
        {faltantes.length > 0 && (
          <div className="aviso aviso-alerta">
            <strong>Quedan campos por completar a mano (aparecen en negrita como [FALTA DATO] en el Word):</strong>
            <ul className="mt-1 list-disc pl-5">{faltantes.map((f, i) => (<li key={i}>{f}</li>))}</ul>
          </div>
        )}
      </div>
      {salidas.length > 0 && (
        <div className="panel p-5">
          <h3 className="mb-2 font-semibold">Descargas</h3>
          <ul className="divide-y divide-[var(--borde)]">
            {salidas.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{a.nombre} <span className="texto-suave text-xs">· {kb(a.tamano)}</span></span>
                <a className="btn btn-sec shrink-0" href={`/api/casos/${caso.id}/archivos/${a.id}?descargar=1`}>Descargar</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
