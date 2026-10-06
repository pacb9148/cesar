"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchivoMeta } from "@/lib/caso/repositorio";
import { BotonIcono } from "@/components/Iconos";
import { EDICION_INICIAL, esEdicionNula } from "@/lib/fotos/recorte";
import { FOTO_ALTO_CM, FOTO_ANCHO_CM } from "@/lib/domain/constantes";
import EditorFoto from "./EditorFoto";

/** Galería de las fotos del caso: se elige cuáles van al informe y se encuadra cada una (7,8 × 6,5 cm) antes de generarlo. */
export default function FotosInforme({ casoId, fotos }: { casoId: string; fotos: ArchivoMeta[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<ArchivoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function llamar(f: ArchivoMeta, metodo: "PUT" | "DELETE", cuerpo?: unknown) {
    setOcupado(f.id);
    setError(null);
    const r = await fetch(`/api/casos/${casoId}/archivos/${f.id}/edicion`, { method: metodo, headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    setOcupado(null);
    if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar");
    router.refresh();
  }

  if (fotos.length === 0) return null;
  const elegidas = fotos.filter((f) => f.edicion?.incluir).length;
  const editadas = fotos.filter((f) => f.edicion && !esEdicionNula(f.edicion)).length;
  const porRecinto = new Map<string, ArchivoMeta[]>();
  for (const f of fotos) porRecinto.set(f.recinto ?? "Sin recinto", [...(porRecinto.get(f.recinto ?? "Sin recinto") ?? []), f]);

  return (
    <div className="panel space-y-3 p-5">
      <h3 className="font-semibold">Fotografías del informe</h3>
      <p className="texto-suave text-sm">
        Cada foto se inserta en un marco de {FOTO_ANCHO_CM} × {FOTO_ALTO_CM} cm. Pulsa el lápiz para encuadrar el área que importa (ampliar, mover, girar, voltear, ajustar). Marca con ✓ las que van al informe:
        si no marcas ninguna, se usan automáticamente las de los recintos con daño (hasta 4 por recinto). El anexo siempre lleva todas.
      </p>
      <p role="status" className="text-sm text-[color:var(--texto)]">
        <strong>{elegidas}</strong> elegidas para el informe · <strong>{editadas}</strong> con recorte editado · {fotos.length} en total
      </p>
      {error && <p role="alert" className="aviso aviso-error">{error}</p>}
      {[...porRecinto.entries()].map(([recinto, lista]) => (
        <section key={recinto} aria-label={`Fotos de ${recinto}`}>
          <h4 className="mb-2 text-sm font-semibold text-[color:var(--texto)]">{recinto} <span className="texto-suave font-normal">({lista.length})</span></h4>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {lista.map((f) => {
              const incluida = !!f.edicion?.incluir;
              const editada = !!f.edicion && !esEdicionNula(f.edicion);
              return (
                <li key={f.id} className={`overflow-hidden rounded-lg border bg-[color:var(--panel-2)] ${incluida ? "border-[color:var(--ok)]" : "border-[color:var(--borde)]"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/casos/${casoId}/archivos/${f.id}?miniatura=1`} alt={`${recinto}: ${f.nombre}`} loading="lazy" className="block w-full bg-black object-cover" style={{ aspectRatio: `${FOTO_ANCHO_CM} / ${FOTO_ALTO_CM}` }} />
                  <div className="space-y-1 p-2">
                    <p className="truncate text-xs text-[color:var(--texto)]" title={f.nombre}>{f.nombre}</p>
                    <div className="flex flex-wrap gap-1 text-[11px]">
                      {incluida && <span className="marca marca-usr !ml-0">En informe</span>}
                      {editada && <span className="marca marca-sin !ml-0">Editada</span>}
                    </div>
                    <div className="flex gap-1">
                      <BotonIcono icono="lapiz" etiqueta={`Editar ${f.nombre}`} onClick={() => setEditando(f)} />
                      <BotonIcono icono="check" etiqueta={incluida ? `Quitar ${f.nombre} del informe` : `Incluir ${f.nombre} en el informe`} activo={incluida} deshabilitado={ocupado === f.id} onClick={() => llamar(f, "PUT", { ...EDICION_INICIAL, ...(f.edicion ?? {}), incluir: !incluida })} />
                      {f.edicion && <BotonIcono icono="reiniciar" etiqueta={`Descartar la edición de ${f.nombre}`} deshabilitado={ocupado === f.id} onClick={() => llamar(f, "DELETE")} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {editando && <EditorFoto key={editando.id} casoId={casoId} foto={editando} onCerrar={() => setEditando(null)} onGuardado={() => { setEditando(null); router.refresh(); }} />}
    </div>
  );
}
