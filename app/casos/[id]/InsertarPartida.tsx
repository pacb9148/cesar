"use client";

import { useMemo, useState } from "react";
import VentanaModal from "@/components/VentanaModal";
import { BAREMO } from "@/lib/engine/baremo";
import { LETRAS_OBS, LEYENDA } from "@/lib/domain/constantes";
import type { LineaAdicional, Unidad } from "@/lib/domain/tipos";
import { obsPorDefecto, partidaNueva, umDe } from "@/lib/caso/asociadas";
import { aplicablesDe, buscarPartidas, complementosDe, MAX_SUGERENCIAS, type Sugerida } from "@/lib/caso/relacion-partidas";
import type { ExtrasMemoria } from "@/lib/caso/partidas-evidencia";
import { coincideEstancia } from "@/lib/fotos/orden";

const UNIDADES: Unidad[] = ["m2", "ml", "gl", "un", "m3", "kg"];
const ELEMENTOS = ["Cielo", "Muro", "Piso", "Cubierta", "Cornisa", "Guardapolvo", "Ventana", "Puerta"];
const n0 = (n: number) => Math.round(n).toLocaleString("es-CL");
const norm = (s: string) => s.trim().toLowerCase();

type Opcional = { marcada: boolean; um: Unidad; cantidad: string | null };
export type DanoParaSugerir = { recinto: string; descripcion: string };

/**
 * Ventana para insertar una partida en el ajuste. Con el recinto y el elemento muestra las 5 partidas aplicables más relevantes (según el daño del acta);
 * al elegir una, muestra sus complementos habituales como opcionales (check, U/M y cantidad editables). Se puede buscar cualquier otra partida de la hoja Datos.
 */
export default function InsertarPartida({ recintos, danos, extras, onInsertar, onCerrar }: { recintos: string[]; danos?: DanoParaSugerir[]; extras?: ExtrasMemoria; onInsertar: (lineas: LineaAdicional[]) => void; onCerrar: () => void }) {
  const [recinto, setRecinto] = useState(recintos[0] ?? "");
  const [elemento, setElemento] = useState("");
  const [principalId, setPrincipalId] = useState<number | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [um, setUm] = useState<Unidad>("m2");
  const [cantidad, setCantidad] = useState("1");
  const [pu, setPu] = useState("");
  const [obs, setObs] = useState<LineaAdicional["obs"]>(["B"]);
  const [buscar, setBuscar] = useState("");
  const [opcionales, setOpcionales] = useState<Record<number, Opcional>>({});
  const [adicionales, setAdicionales] = useState<Sugerida[]>([]);
  const [buscarAdicional, setBuscarAdicional] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dano = useMemo(() => (danos ?? []).filter((d) => coincideEstancia(d.recinto, recinto)).map((d) => d.descripcion).join(" "), [danos, recinto]);
  const aplicables = useMemo(() => aplicablesDe({ elemento, dano, extras }), [elemento, dano, extras]);
  const encontradas = useMemo(() => buscarPartidas(buscar), [buscar]);
  const complementos = useMemo(() => {
    const sugeridos = principalId ? complementosDe(principalId, { elemento, extras }) : [];
    const ya = new Set(sugeridos.map((s) => s.id));
    return [...sugeridos, ...adicionales.filter((a) => !ya.has(a.id) && a.id !== principalId)];
  }, [principalId, elemento, extras, adicionales]);
  const encontradasAdicionales = useMemo(() => buscarPartidas(buscarAdicional).filter((s) => s.id !== principalId && !complementos.some((c) => c.id === s.id)), [buscarAdicional, principalId, complementos]);

  const cant = Number(cantidad);
  const precio = Number(pu);
  const total = cant > 0 && precio > 0 ? cant * precio : 0;
  const principal = principalId ? BAREMO.find((b) => b.id === principalId) : undefined;

  /** Al elegir una partida de la hoja Datos toma su U/M, su precio y sus observaciones habituales; sus complementos se recalculan. */
  function elegirPrincipal(s: Sugerida) {
    const u = umDe(s.id);
    setPrincipalId(s.id);
    setDescripcion(s.descripcion);
    setUm(u);
    setPu(String(s.pu));
    setObs(obsPorDefecto(u));
    setOpcionales({});
    setAdicionales([]);
    setBuscar("");
    setError(null);
  }
  const cantidadDe = (id: number, u: Unidad) => opcionales[id]?.cantidad ?? (u === um ? cantidad : "");
  const estadoDe = (s: Sugerida): Opcional => opcionales[s.id] ?? { marcada: false, um: umDe(s.id), cantidad: null };
  const cambiarOpcional = (s: Sugerida, p: Partial<Opcional>) => setOpcionales((o) => ({ ...o, [s.id]: { ...estadoDe(s), ...o[s.id], ...p } }));
  const agregarAdicional = (s: Sugerida) => {
    setAdicionales((a) => [...a, { ...s, motivo: "agregada por ti" }]);
    setOpcionales((o) => ({ ...o, [s.id]: { marcada: true, um: umDe(s.id), cantidad: null } }));
    setBuscarAdicional("");
  };

  function insertar() {
    if (!recinto.trim()) return setError("Elige el recinto.");
    if (!descripcion.trim()) return setError("Elige una partida aplicable, busca otra o escribe la descripción.");
    if (!(cant > 0)) return setError("La cantidad debe ser mayor que 0.");
    if (!(precio > 0)) return setError("El precio unitario debe ser mayor que 0.");
    const elegidas = complementos.filter((c) => estadoDe(c).marcada);
    for (const c of elegidas) if (!(Number(cantidadDe(c.id, estadoDe(c).um)) > 0)) return setError(`Falta la cantidad de «${c.descripcion}».`);
    const nueva = partidaNueva({ recinto, elemento, descripcion, um, cantidad: cant, pu: precio, obs, baremoId: principal && principal.pu === precio && norm(principal.descripcion) === norm(descripcion) ? principal.id : null });
    const extra = elegidas.map((c) => {
      const e = estadoDe(c);
      return partidaNueva({ recinto, elemento, descripcion: c.descripcion, um: e.um, cantidad: Number(cantidadDe(c.id, e.um)), pu: c.pu, obs: obsPorDefecto(e.um), baremoId: c.id });
    });
    onInsertar([nueva, ...extra]);
  }

  const fila = (s: Sugerida, accion: React.ReactNode) => (
    <div className="flex items-start gap-2">
      {accion}
      <span className="min-w-0 flex-1">
        {s.descripcion} <span className="texto-suave text-xs">· ${n0(s.pu)}{s.motivo ? ` · ${s.motivo}` : ""}</span>
      </span>
    </div>
  );

  return (
    <VentanaModal etiqueta="Insertar partida en el ajuste" titulo="Insertar partida" subtitulo="Se agrega a continuación de la última partida del recinto elegido y suma en los totales del ajuste." onCerrar={onCerrar} ancho="max-w-4xl" nivel={60}
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

          <section aria-label="Dónde" className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="font-medium">Recinto</span>
              <input list="ins-recintos" className="campo w-full" value={recinto} onChange={(e) => setRecinto(e.target.value.toUpperCase())} />
              <datalist id="ins-recintos">{recintos.map((r) => (<option key={r} value={r} />))}</datalist>
            </label>
            <div className="space-y-1">
              <span className="font-medium">Elemento</span>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Elemento">
                {ELEMENTOS.map((x) => (
                  <button key={x} type="button" aria-pressed={norm(elemento) === norm(x)} className={`btn !px-2 !py-0.5 text-xs ${norm(elemento) === norm(x) ? "" : "btn-sec"}`} onClick={() => setElemento(norm(elemento) === norm(x) ? "" : x)}>
                    {x}
                  </button>
                ))}
              </div>
            </div>
            {dano && <p className="texto-suave text-xs sm:col-span-2">Daño descrito en la inspección para este recinto: «{dano}»</p>}
          </section>

          <section aria-label="Partidas aplicables" className="space-y-2 rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel-2)] p-3">
            <h3 className="font-semibold">Partidas aplicables {elemento ? `a ${elemento.toLowerCase()}` : ""}</h3>
            {!elemento ? (
              <p className="texto-suave">Elige el elemento (cielo, muro…) para ver las {MAX_SUGERENCIAS} partidas más aplicables, o busca una partida abajo.</p>
            ) : aplicables.length === 0 ? (
              <p className="texto-suave">No hay sugerencias para este elemento: busca la partida abajo.</p>
            ) : (
              <ul className="space-y-1">
                {aplicables.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input type="radio" name="ins-principal" className="mt-0.5" checked={principalId === s.id} onChange={() => elegirPrincipal(s)} />
                      <span className="min-w-0 flex-1">
                        {s.descripcion} <span className="texto-suave text-xs">· {umDe(s.id)} · ${n0(s.pu)} · {s.motivo}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <label className="block space-y-1">
              <span className="font-medium">Buscar otra partida de la hoja Datos</span>
              <input className="campo w-full" value={buscar} placeholder="Escribe parte de la descripción…" onChange={(e) => setBuscar(e.target.value)} />
            </label>
            {buscar.trim().length > 1 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto" aria-label="Resultados de la búsqueda">
                {encontradas.length === 0 && <li className="texto-suave">Sin resultados.</li>}
                {encontradas.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="w-full text-left hover:underline" onClick={() => elegirPrincipal(s)}>
                      {s.descripcion} <span className="texto-suave text-xs">· {umDe(s.id)} · ${n0(s.pu)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Partida elegida" className="space-y-3">
            <label className="block space-y-1">
              <span className="font-medium">Descripción</span>
              <input className="campo w-full" value={descripcion} placeholder="Elige una partida arriba o escribe una propia" onChange={(e) => setDescripcion(e.target.value)} />
              <span className="texto-suave text-xs">{principal && norm(principal.descripcion) === norm(descripcion) ? "Partida de la hoja Datos: toma su precio." : "Partida propia: precio manual."}</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="space-y-1">
                <span className="font-medium">U/M</span>
                <select className="campo w-full" value={um} onChange={(e) => setUm(e.target.value as Unidad)}>
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
          </section>

          {principalId !== null && (
            <section aria-label="Partidas complementarias" className="space-y-2 rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel-2)] p-3">
              <h3 className="font-semibold">Partidas complementarias (opcionales)</h3>
              <p className="texto-suave text-xs">Suelen acompañar a esta partida. Marca las que correspondan y ajusta su U/M y su cantidad: se insertan en el mismo recinto y elemento.</p>
              {complementos.length === 0 && <p className="texto-suave">No hay complementos habituales para esta partida: puedes buscar adicionales abajo.</p>}
              <ul className="space-y-2">
                {complementos.map((s) => {
                  const e = estadoDe(s);
                  const c = Number(cantidadDe(s.id, e.um));
                  return (
                    <li key={s.id} className="grid items-start gap-2 sm:grid-cols-[1fr_5rem_6rem_6rem]">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input type="checkbox" className="mt-0.5" checked={e.marcada} onChange={() => cambiarOpcional(s, { marcada: !e.marcada })} />
                        <span className="min-w-0 flex-1">
                          {s.descripcion} <span className="texto-suave text-xs">· ${n0(s.pu)} · {s.motivo}</span>
                        </span>
                      </label>
                      <select aria-label={`U/M de ${s.descripcion}`} className="campo w-full" value={e.um} onChange={(ev) => cambiarOpcional(s, { um: ev.target.value as Unidad })}>
                        {UNIDADES.map((u) => (<option key={u} value={u}>{u}</option>))}
                      </select>
                      <input aria-label={`Cantidad de ${s.descripcion}`} type="number" step="any" min="0" className="campo w-full text-right" placeholder="Cant." value={cantidadDe(s.id, e.um)} onChange={(ev) => cambiarOpcional(s, { cantidad: ev.target.value })} />
                      <span className="whitespace-nowrap pt-1 text-right tabular-nums">${n0(c > 0 ? c * s.pu : 0)}</span>
                    </li>
                  );
                })}
              </ul>
              <label className="block space-y-1">
                <span className="font-medium">Buscar adicionales</span>
                <input className="campo w-full" value={buscarAdicional} placeholder="Escribe parte de la descripción de otra partida…" onChange={(e) => setBuscarAdicional(e.target.value)} />
              </label>
              {buscarAdicional.trim().length > 1 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto" aria-label="Resultados de adicionales">
                  {encontradasAdicionales.length === 0 && <li className="texto-suave">Sin resultados.</li>}
                  {encontradasAdicionales.map((s) => (
                    <li key={s.id}>{fila(s, <button type="button" className="btn btn-sec !px-2 !py-0 text-xs" onClick={() => agregarAdicional(s)}>Agregar</button>)}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </VentanaModal>
  );
}
