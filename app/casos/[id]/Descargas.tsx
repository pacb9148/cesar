"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchivoMeta, Caso } from "@/lib/caso/repositorio";
import { Icono } from "@/components/Iconos";
import TituloAyuda from "@/components/Ayuda";
import VistaDocumento from "./VistaDocumento";
import VistaSimple from "./VistaSimple";

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** Paso «Editar y descargar»: todos los documentos generados con su botón de edición (o vista) y de descarga. */
export default function Descargas({ caso, archivos }: { caso: Caso; archivos: ArchivoMeta[] }) {
  const router = useRouter();
  const [viendo, setViendo] = useState<{ id: string; nombre: string } | null>(null);
  const [simple, setSimple] = useState<{ id: string; nombre: string } | null>(null);
  const salidas = archivos.filter((a) => a.tipo === "salida");

  return (
    <section className="space-y-4">
      <div className="panel p-5">
        <TituloAyuda titulo="Editar y descargar" nivel={2}>
          <p>Aquí están todos los documentos generados. Word, Excel y el anexo se editan en pantalla; el PDF se abre para revisarlo; el resumen de texto se edita y el ZIP muestra su contenido. Cada uno se puede descargar.</p>
        </TituloAyuda>
        {salidas.length === 0 ? (
          <p className="texto-suave mt-3 text-sm">Aún no hay documentos: genéralos en el paso «Informe».</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--borde)]">
            {salidas.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{a.nombre} <span className="texto-suave text-xs">· {kb(a.tamano)}</span></span>
                <span className="flex shrink-0 gap-2">
                  {/\.(docx|xlsx)$/i.test(a.nombre) && (
                    <button type="button" className="btn btn-sec" onClick={() => setViendo({ id: a.id, nombre: a.nombre })} aria-label={`Ver y editar ${a.nombre}`}>
                      <Icono nombre="ojo" /> Ver y editar
                    </button>
                  )}
                  {/\.(txt|zip)$/i.test(a.nombre) && (
                    <button type="button" className="btn btn-sec" onClick={() => setSimple({ id: a.id, nombre: a.nombre })} aria-label={`${/\.txt$/i.test(a.nombre) ? "Ver y editar" : "Ver contenido de"} ${a.nombre}`}>
                      <Icono nombre="ojo" /> {/\.txt$/i.test(a.nombre) ? "Ver y editar" : "Ver contenido"}
                    </button>
                  )}
                  {/\.pdf$/i.test(a.nombre) && (
                    <a className="btn btn-sec" href={`/api/casos/${caso.id}/archivos/${a.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Ver ${a.nombre}`}>
                      <Icono nombre="ojo" /> Ver
                    </a>
                  )}
                  <a className="btn btn-sec" href={`/api/casos/${caso.id}/archivos/${a.id}?descargar=1`}>Descargar</a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {simple && <VistaSimple key={simple.id} casoId={caso.id} archivoId={simple.id} nombre={simple.nombre} onCerrar={() => setSimple(null)} onGuardado={() => router.refresh()} />}
      {viendo && <VistaDocumento key={viendo.id} casoId={caso.id} archivoId={viendo.id} nombre={viendo.nombre} onCerrar={() => setViendo(null)} onGuardado={() => router.refresh()} />}
    </section>
  );
}
