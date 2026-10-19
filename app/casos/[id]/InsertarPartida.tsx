"use client";

import { useMemo, useState } from "react";
import VentanaModal from "@/components/VentanaModal";
import { BAREMO } from "@/lib/engine/baremo";
import { LETRAS_OBS, LEYENDA } from "@/lib/domain/constantes";
import type { LineaAdicional, Unidad } from "@/lib/domain/tipos";
import { asociadasDe, obsPorDefecto, partidaNueva, umDe } from "@/lib/caso/asociadas";
import type { ExtrasMemoria } from "@/lib/caso/partidas-evidencia";

const UNIDADES: Unidad[] = ["m2", "ml", "gl", "un", "m3", "kg"];
const ELEMENTOS = ["Cielo", "Muro", "Piso", "Cubierta", "Cornisa", "Guardapolvo", "Ventana", "Puerta", "Otros"];
const n0 = (n: number) => Math.round(n).toLocaleString("es-CL");
const norm = (s: string) => s.trim().toLowerCase();
const ORIGEN: Record<string, string> = { complemento: "usada junto a esta en los ajustes de referencia", conjunto: "del mismo conjunto de reparación", aprendido: "la agregas habitualmente en este elemento" };

/**
 * Ventana para insertar una partida en el ajuste: recinto, elemento y la partida de la hoja Datos (con su U/M y precio), cantidad y observaciones.
 * Si la partida tiene complementos habituales (preparación, empaste, pintura…) los lista, todos con su misma U/M, para agregarlos de una vez.
 */
export default function InsertarPartida({ recintos, extras, onInsertar, onCerrar }: { recintos: string[]; extras?: ExtrasMemoria; onInsertar: (lineas: LineaAdicional[]) => void; onCerrar: () => void }) {
  const [recinto, setRecinto] = useState(recintos[0] ?? "");
  const [elemento, setElemento] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [um, setUm] = useState<Unidad>("m2");
  const [cantidad, setCantidad] = useState("1");
  const [pu, setPu] = useState("");
  const [obs, setObs] = useState<LineaAdicional["obs"]>(["B"]);
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const baremo = useMemo(() => BAREMO.find((b) => norm(b.descripcion) === norm(descripcion)), [descripcion]);
  const cant = Number(cantidad);
  const precio = Number(pu);
  const total = cant > 0 && precio > 0 ? cant * precio : 0;
  const asociadas = useMemo(() => (baremo ? asociadasDe(baremo.id, { um, elemento, extras }) : []), [baremo, um, elemento, extras]);

  /** Al elegir una partida de la hoja Datos toma su U/M, su precio y sus observaciones habituales. */
  function elegirDescripcion(texto: string) {
    setDescripcion(texto);
    setMarcadas(new Set());
    const b = BAREMO.find((x) => norm(x.descripcion) === norm(texto));
    if (!b) return;
    const u = umDe(b.id);
    setUm(u);
    setPu(String(b.pu));
    setObs(obsPorDefecto(u));
  }
  const cambiarUm = (u: Unidad) => {
    setUm(u);
    setMarcadas(new Set());
    if (!baremo) setObs(obsPorDefecto(u));
  };
  const alternar = (id: number) =>
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function insertar() {
    if (!recinto.trim()) return setError("Elige el recinto.");
    if (!descripcion.trim()) return setError("Elige o escribe la descripción de la partida.");
    if (!(cant > 0)) return setError("La cantidad debe ser mayor que 0.");
    if (!(precio > 0)) return setError("El precio unitario debe ser mayor que 0.");
    const principal = partidaNueva({ recinto, elemento, descripcion, um, cantidad: cant, pu: precio, obs, baremoId: baremo && baremo.pu === precio ? baremo.id : null });
    const complementos = asociadas.filter((a) => marcadas.has(a.id)).map((a) => partidaNueva({ recinto, elemento, descripcion: a.descripcion, um: a.um, cantidad: cant, pu: a.pu, obs: obsPorDefecto(a.um), baremoId: a.id }));
    onInsertar([principal, ...complementos]);
  }

  return (
    <VentanaModal etiqueta="Insertar partida en el ajuste" titulo="Insertar partida" subtitulo="Se agrega a continuación de la última partida del recinto elegido y suma en los totales del ajuste." onCerrar={onCerrar} ancho="max-w-3xl" nivel={60}
      acciones={
        <button type="button" className="btn !px-3 !py-1.5 text-sm" onClick={insertar}>
          Insertar partida
        </button>
      }
    >
      {() => (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto text-sm text-[color:var(--texto)]">
          {error && (
            <p role="alert" className="aviso aviso-error">
              {error}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="font-medium">Recinto</span>
              <input list="ins-recintos" className="campo w-full" value={recinto} onChange={(e) => setRecinto(e.target.value.toUpperCase())} />
              <datalist id="ins-recintos">{recintos.map((r) => (<option key={r} value={r} />))}</datalist>
            </label>
            <label className="space-y-1">
              <span className="font-medium">Elemento</span>
              <input list="ins-elementos" className="campo w-full" value={elemento} placeholder="Cielo, Muro…" onChange={(e) => setElemento(e.target.value)} />
              <datalist id="ins-elementos">{ELEMENTOS.map((x) => (<option key={x} value={x} />))}</datalist>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="font-medium">Descripción (partida de la hoja Datos)</span>
            <input list="ins-baremo" className="campo w-full" value={descripcion} placeholder="Escribe para buscar…" onChange={(e) => elegirDescripcion(e.target.value)} />
            <datalist id="ins-baremo">{BAREMO.map((b) => (<option key={b.id} value={b.descripcion} />))}</datalist>
            <span className="texto-suave text-xs">{baremo ? "Partida de la hoja Datos: toma su U/M y su precio." : "Si no coincide con la hoja Datos queda como partida de precio manual."}</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1">
              <span className="font-medium">U/M</span>
              <select className="campo w-full" value={um} onChange={(e) => cambiarUm(e.target.value as Unidad)}>
                {UNIDADES.map((u) => (<option key={u} value={u}>{u}</option>))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium">Cantidad</span>
              <input type="number" step="any" min="0" className="campo w-full text-right" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="font-medium">P. unit. ($)</span>
              <input type="number" step="any" min="0" className="campo w-full text-right" value={pu} onChange={(e) => setPu(e.target.value)} />
            </label>
            <div className="space-y-1">
              <span className="font-medium">Total ($)</span>
              <output className="campo block w-full text-right font-semibold" aria-label="Total de la partida">{n0(total)}</output>
            </div>
          </div>
          <fieldset className="space-y-1">
            <legend className="font-medium">OBS</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {LETRAS_OBS.filter((l) => l !== "F").map((l) => (
                <label key={l} className="flex cursor-pointer items-start gap-1" title={LEYENDA[l]}>
                  <input type="checkbox" className="mt-0.5" checked={obs.includes(l)} onChange={() => setObs((o) => (o.includes(l) ? o.filter((x) => x !== l) : [...o, l].sort()))} />
                  <span><strong>{l}</strong> <span className="texto-suave text-xs">{LEYENDA[l]}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          {baremo && (
            <section aria-label="Partidas asociadas" className="space-y-2 rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel-2)] p-3">
              <h3 className="font-semibold">Partidas asociadas (U/M {um})</h3>
              {asociadas.length === 0 ? (
                <p className="texto-suave">No hay partidas complementarias con la misma U/M para esta partida.</p>
              ) : (
                <>
                  <p className="texto-suave text-xs">Suelen aplicarse junto a esta partida. Marca las que correspondan: se agregan con la misma cantidad y a su precio de la hoja Datos.</p>
                  <ul className="space-y-1">
                    {asociadas.map((a) => (
                      <li key={a.id}>
                        <label className="flex cursor-pointer items-start gap-2">
                          <input type="checkbox" className="mt-0.5" checked={marcadas.has(a.id)} onChange={() => alternar(a.id)} />
                          <span className="min-w-0 flex-1">
                            {a.descripcion} <span className="texto-suave text-xs">· {a.um} · ${n0(a.pu)} · {ORIGEN[a.origen]}{a.veces > 1 ? ` (${a.veces}×)` : ""}</span>
                          </span>
                          <span className="whitespace-nowrap tabular-nums">${n0(a.pu * (cant > 0 ? cant : 0))}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn btn-sec !px-2 !py-0.5 text-xs" onClick={() => setMarcadas(marcadas.size === asociadas.length ? new Set() : new Set(asociadas.map((a) => a.id)))}>
                    {marcadas.size === asociadas.length ? "Quitar todas" : "Marcar todas"}
                  </button>
                </>
              )}
            </section>
          )}
        </div>
      )}
    </VentanaModal>
  );
}
