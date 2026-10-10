"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchivoMeta } from "@/lib/caso/repositorio";
import { BotonIcono, Icono } from "@/components/Iconos";
import { EDICION_INICIAL, esEdicionNula } from "@/lib/fotos/recorte";
import { FOTO_TAMANO_TEXTO, FOTO_ALTO_CM, FOTO_ANCHO_CM } from "@/lib/domain/constantes";
import EditorFoto from "./EditorFoto";

/**
 * Galería de las fotos del caso. Parte con marcadas las que el sistema pone en el informe; el usuario desmarca las que no quiere,
 * marca otras, las encuadra y escribe la leyenda de cada grupo. Cada cambio rehace el informe y el anexo.
 */
export default function FotosInforme({ casoId, fotos, enInforme, leyendasGrupos }: { casoId: string; fotos: ArchivoMeta[]; enInforme: string[]; leyendasGrupos: Record<string, string> }) {
  const router = useRouter();
  const [editando, setEditando] = useState<ArchivoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [pies, setPies] = useState<Record<string, string>>(leyendasGrupos);

  async function llamar(f: ArchivoMeta, metodo: "PUT" | "DELETE", cuerpo?: unknown) {
    setOcupado(f.id);
    setError(null);
    const r = await fetch(`/api/casos/${casoId}/archivos/${f.id}/edicion`, { method: metodo, headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    setOcupado(null);
    if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar");
    router.refresh();
  }

  async function guardarPie(recinto: string) {
    setOcupado(`grupo:${recinto}`);
    setError(null);
    const r = await fetch(`/api/casos/${casoId}/fotos-grupos`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recinto, leyenda: pies[recinto] ?? "" }) });
    setOcupado(null);
    if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar la leyenda");
    router.refresh();
  }

  if (fotos.length === 0) return null;
  const va = new Set(enInforme);
  const editadas = fotos.filter((f) => f.edicion && !esEdicionNula(f.edicion)).length;
  const porRecinto = new Map<string, ArchivoMeta[]>();
  for (const f of fotos) porRecinto.set(f.recinto ?? "Sin recinto", [...(porRecinto.get(f.recinto ?? "Sin recinto") ?? []), f]);

  return (
    <div className="panel space-y-3 p-5">
      <h3 className="font-semibold">Fotografías del informe</h3>
      <p className="texto-suave text-sm">
        Cada foto se inserta en un marco de {FOTO_TAMANO_TEXTO} (tabla de {FOTO_ANCHO_CM * 2} cm). Ya vienen marcadas con ✓ las que el sistema pone en el informe (las de los recintos con daño, hasta 6 por recinto):
        desmarca las que no quieras, marca otras o pulsa el lápiz para encuadrarlas. Cada grupo lleva el nombre de su estancia y puedes escribirle una leyenda al pie. Todo cambio rehace el informe, el anexo, el PDF y el ZIP;
        el anexo siempre lleva todas las fotos. La leyenda de cada foto es opcional: sin texto no sale ninguna.
      </p>
      <p role="status" className="text-sm text-[color:var(--texto)]">
        <strong>{va.size}</strong> en el informe · <strong>{editadas}</strong> con recorte editado · {fotos.length} en total
      </p>
      {error && <p role="alert" className="aviso aviso-error">{error}</p>}
      {ocupado && <p role="status" className="aviso aviso-ok">Actualizando el informe, el anexo y el PDF con tus cambios… puede tardar unos segundos.</p>}
      {[...porRecinto.entries()].map(([recinto, lista]) => {
        const nVan = lista.filter((f) => va.has(f.id)).length;
        const pie = pies[recinto] ?? "";
        const pieGuardado = leyendasGrupos[recinto] ?? "";
        return (
          // Cada estancia es un grupo plegable, cerrado al comienzo; el resumen dice cuántas fotos van al informe.
          <details key={recinto} className="rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel)]">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-2 text-sm font-semibold text-[color:var(--texto)]">
              <span>{recinto}</span>
              <span className="texto-suave font-normal">({lista.length} fotos)</span>
              <span className={`marca ${nVan > 0 ? "marca-usr" : "marca-sin"} !ml-0`}>{nVan} en el informe</span>
              {lista.some((f) => f.edicion && !esEdicionNula(f.edicion)) && <span className="marca marca-sin !ml-0">{lista.filter((f) => f.edicion && !esEdicionNula(f.edicion)).length} editadas</span>}
              {pieGuardado && <span className="marca marca-sin !ml-0">con leyenda de grupo</span>}
            </summary>
            <div className="space-y-1 p-2">
              <label className="etiqueta" htmlFor={`pie-${recinto}`}>Leyenda al pie del grupo «{recinto}» (opcional)</label>
              <div className="flex flex-wrap gap-2">
                <input id={`pie-${recinto}`} className="campo min-w-64 flex-1 px-2 py-1 text-sm" maxLength={300} placeholder="Descripción breve de las fotos de este grupo" value={pie} onChange={(e) => setPies((p) => ({ ...p, [recinto]: e.target.value }))} />
                <button type="button" className="btn btn-sec !px-3 !py-1 text-sm" disabled={pie.trim() === pieGuardado || ocupado === `grupo:${recinto}`} onClick={() => void guardarPie(recinto)}>Guardar leyenda</button>
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-3 p-2 sm:grid-cols-3 lg:grid-cols-4">
              {lista.map((f) => {
                const incluida = va.has(f.id);
                const quitada = f.edicion?.excluir === true;
                const editada = !!f.edicion && !esEdicionNula(f.edicion);
                return (
                  <li key={f.id} className={`overflow-hidden rounded-lg bg-[color:var(--panel-2)] ${incluida ? "border-2 border-[color:var(--ok)]" : "border border-[color:var(--borde)]"}`}>
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/casos/${casoId}/archivos/${f.id}?miniatura=1`} alt={`${recinto}: ${f.nombre}`} loading="lazy" className="block w-full bg-black object-cover" style={{ aspectRatio: `${FOTO_ANCHO_CM} / ${FOTO_ALTO_CM}`, opacity: incluida ? 1 : 0.55 }} />
                      {incluida && (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--ok)", color: "var(--ok-fondo)" }}>
                          <Icono nombre="check" tam={14} /> En el informe
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 p-2">
                      <p className="truncate text-xs text-[color:var(--texto)]" title={f.nombre}>{f.nombre}</p>
                      <div className="flex flex-wrap gap-1 text-[11px]">
                        {editada && <span className="marca marca-sin !ml-0">Editada</span>}
                        {quitada && <span className="marca marca-error !ml-0">Quitada del informe</span>}
                      </div>
                      <div className="flex gap-1">
                        <BotonIcono icono="lapiz" etiqueta={`Editar ${f.nombre}`} onClick={() => setEditando(f)} />
                        <BotonIcono icono="check" etiqueta={incluida ? `Quitar ${f.nombre} del informe` : `Poner ${f.nombre} en el informe`} activo={incluida} deshabilitado={ocupado === f.id} onClick={() => llamar(f, "PUT", { ...EDICION_INICIAL, ...(f.edicion ?? {}), incluir: !incluida, excluir: incluida })} />
                        {f.edicion && <BotonIcono icono="reiniciar" etiqueta={`Descartar la edición de ${f.nombre}`} deshabilitado={ocupado === f.id} onClick={() => llamar(f, "DELETE")} />}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
      {editando && <EditorFoto key={editando.id} casoId={casoId} foto={editando} enInforme={va.has(editando.id)} onCerrar={() => setEditando(null)} onGuardado={() => { setEditando(null); router.refresh(); }} />}
    </div>
  );
}
