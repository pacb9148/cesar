"use client";

import { useMemo, useState } from "react";
import type { LineaAdicional, SalidaAgente } from "@/lib/domain/tipos";
import type { ActaInspeccion } from "@/lib/extraccion/acta";
import { LEYENDA, LETRAS_OBS } from "@/lib/domain/constantes";
import { BAREMO } from "@/lib/engine/baremo";
import { ordenarAdicionales, partidasDeEvidencia, type ExtrasMemoria } from "@/lib/caso/partidas-evidencia";
import TituloAyuda from "@/components/Ayuda";
import { coincideEstancia } from "@/lib/fotos/orden";

const UNIDADES = ["m2", "ml", "gl", "un", "m3", "kg"] as const;
const n0 = (n: number) => Math.round(n).toLocaleString("es-CL");
const clave = (a: Pick<LineaAdicional, "seccion" | "descripcion">) => `${a.seccion.toLowerCase()}|${a.descripcion.toLowerCase()}`;

/**
 * Partidas propias del liquidador. Sin presupuesto del contratista son la base de la liquidación: salen de la evidencia de la inspección (a precio de la
 * hoja Datos) y el usuario puede editarlas, quitarlas y agregar las que falten. El precio se toma del baremo al elegir una partida; si lo cambias a mano queda como precio de mercado.
 */
export default function PartidasLiquidador({ salida, setSalida, acta, secciones, extras, orden }: { extras?: ExtrasMemoria; orden?: string[]; salida: SalidaAgente; setSalida: (f: (s: SalidaAgente | null) => SalidaAgente | null) => void; acta: ActaInspeccion | null; secciones: string[] }) {
  const [aviso, setAviso] = useState<string | null>(null);
  const filas = salida.lineas_adicionales;
  const recintos = useMemo(() => [...new Set([...secciones, ...(acta?.danos ?? []).map((d) => d.recinto.trim().toUpperCase())])], [secciones, acta]);

  const cambiar = (i: number, p: Partial<LineaAdicional>) => setSalida((s) => (s ? { ...s, lineas_adicionales: s.lineas_adicionales.map((a, k) => (k === i ? { ...a, ...p } : a)) } : s));
  const quitar = (i: number) => setSalida((s) => (s ? { ...s, lineas_adicionales: s.lineas_adicionales.filter((_, k) => k !== i) } : s));
  const agregar = () =>
    setSalida((s) =>
      s ? { ...s, lineas_adicionales: [...s.lineas_adicionales, { seccion: recintos[0] ?? "GENERAL", descripcion: "", um: "m2", cantidad: 1, pu: 1, pu_origen: "mercado:manual", obs: ["B"], justificacion: "Partida agregada por el liquidador." }] } : s,
    );

  /** Al escribir o elegir una descripción del baremo, la partida toma su precio y su origen. */
  function elegirDescripcion(i: number, texto: string) {
    const b = BAREMO.find((x) => x.descripcion.trim().toLowerCase() === texto.trim().toLowerCase());
    cambiar(i, b ? { descripcion: b.descripcion, pu: b.pu, pu_origen: `baremo:${b.id}` } : { descripcion: texto });
  }
  function cambiarPrecio(i: number, pu: number) {
    if (!(pu > 0)) return;
    const a = filas[i];
    const b = a.pu_origen.startsWith("baremo:") ? BAREMO.find((x) => `baremo:${x.id}` === a.pu_origen) : undefined;
    cambiar(i, { pu, pu_origen: b && b.pu === pu ? a.pu_origen : "mercado:manual" });
  }

  function desdeEvidencia() {
    if (!acta) return setAviso("Falta la inspección: lee primero los documentos.");
    const g = partidasDeEvidencia(acta, { omitirEstancias: secciones, extras });
    const ya = new Set(filas.map(clave));
    const nuevas = g.partidas.filter((p) => !ya.has(clave(p)));
    setSalida((s) => (s ? { ...s, lineas_adicionales: ordenarAdicionales([...s.lineas_adicionales, ...nuevas], orden ?? acta.danos.map((d) => d.recinto)) } : s));
    setAviso(`${nuevas.length} partida(s) agregada(s) desde la evidencia de la inspección.${g.sinPartida.length ? ` ${g.sinPartida.join(" ")}` : ""}`);
  }

  // Estancias de la inspección que todavía no están en el ajuste ni en el presupuesto.
  const faltan = [...new Set((acta?.danos ?? []).map((d) => d.recinto.trim().toUpperCase()))].filter((r) => !filas.some((a) => coincideEstancia(a.seccion, r)) && !secciones.some((s) => coincideEstancia(s, r)));
  const total = filas.reduce((t, a) => t + a.cantidad * a.pu, 0);

  return (
    <div className="panel space-y-3 p-5">
      <TituloAyuda titulo="Partidas del liquidador" nivel={3}>
        <p>
          Sin presupuesto del contratista, esta es la base de la liquidación: «Generar desde la evidencia» convierte los daños de la inspección en partidas a precio de la hoja Datos (preparación de superficie, empaste y lijado, y pintura de cada cielo y muro afectado).
          Edita cantidades y precios, quita lo que no corresponda y agrega las partidas que falten (al elegir una descripción del baremo toma su precio). Luego guarda el ajuste.
        </p>
      </TituloAyuda>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={desdeEvidencia} disabled={!acta}>Generar desde la evidencia</button>
        <button type="button" className="btn btn-sec" onClick={agregar}>Agregar partida</button>
        {filas.length > 0 && (
          <button type="button" className="btn btn-sec" onClick={() => window.confirm("¿Quitar todas las partidas del liquidador?") && setSalida((s) => (s ? { ...s, lineas_adicionales: [] } : s))}>Quitar todas</button>
        )}
        <span className="ml-auto text-sm text-[color:var(--texto)]">Total directo: <strong>${n0(total)}</strong></span>
      </div>
      {faltan.length > 0 && <p role="alert" className="aviso aviso-alerta text-sm">Faltan {faltan.length} estancia(s) de la inspección en el ajuste: {faltan.join(", ")}. Usa «Generar desde la evidencia» para agregarlas con sus partidas.</p>}
      {aviso && <p role="status" className="aviso aviso-ok text-sm">{aviso}</p>}
      <datalist id="lista-baremo">{BAREMO.map((b) => (<option key={b.id} value={b.descripcion} />))}</datalist>
      <datalist id="lista-elementos">{["Cielo", "Muro", "Piso", "Cubierta", "Cornisa", "Guardapolvo"].map((x) => (<option key={x} value={x} />))}</datalist>
      <datalist id="lista-recintos">{recintos.map((r) => (<option key={r} value={r} />))}</datalist>
      {filas.length === 0 ? (
        <p className="texto-suave text-sm">Aún no hay partidas. Usa «Generar desde la evidencia» o «Agregar partida».</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Recinto</th>
                <th>Elemento</th>
                <th className="min-w-56 text-left">Descripción</th>
                <th>U/M</th>
                <th>Cantidad</th>
                <th>P. unit. ($)</th>
                <th>Total ($)</th>
                <th>OBS</th>
                <th><span className="sr-only">Quitar</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a, i) => (
                <tr key={i}>
                  <td><input aria-label={`Recinto de la partida ${i + 1}`} list="lista-recintos" className="campo w-36 px-1 py-0.5" value={a.seccion} onChange={(e) => cambiar(i, { seccion: e.target.value.toUpperCase() })} /></td>
                  <td><input aria-label={`Elemento de la partida ${i + 1}`} list="lista-elementos" className="campo w-24 px-1 py-0.5" value={a.elemento ?? ""} onChange={(e) => cambiar(i, { elemento: e.target.value || undefined })} /></td>
                  <td>
                    <input aria-label={`Descripción de la partida ${i + 1}`} list="lista-baremo" className="campo w-full min-w-56 px-1 py-0.5" value={a.descripcion} onChange={(e) => elegirDescripcion(i, e.target.value)} />
                    <div className="texto-suave text-xs">{a.pu_origen.startsWith("baremo:") ? "Precio de la hoja Datos" : "Precio manual (de mercado)"}</div>
                  </td>
                  <td>
                    <select aria-label={`Unidad de la partida ${i + 1}`} className="campo px-1 py-0.5" value={a.um} onChange={(e) => cambiar(i, { um: e.target.value as LineaAdicional["um"] })}>
                      {UNIDADES.map((u) => (<option key={u} value={u}>{u}</option>))}
                    </select>
                  </td>
                  <td><input aria-label={`Cantidad de la partida ${i + 1}`} type="number" step="any" min="0" className="campo w-20 px-1 py-0.5 text-right" value={a.cantidad} onChange={(e) => Number(e.target.value) >= 0 && cambiar(i, { cantidad: Number(e.target.value) })} /></td>
                  <td><input aria-label={`Precio unitario de la partida ${i + 1}`} type="number" step="any" min="1" className="campo w-24 px-1 py-0.5 text-right" value={a.pu} onChange={(e) => cambiarPrecio(i, Number(e.target.value))} /></td>
                  <td className="n">{n0(a.cantidad * a.pu)}</td>
                  <td>
                    <div className="flex flex-wrap justify-center gap-1">
                      {LETRAS_OBS.filter((l) => l !== "F").map((l) => (
                        <label key={l} title={LEYENDA[l]} className="cursor-pointer text-xs text-[color:var(--texto)]">
                          <input type="checkbox" className="mr-0.5" checked={a.obs.includes(l)} onChange={() => cambiar(i, { obs: a.obs.includes(l) ? a.obs.filter((x) => x !== l) : [...a.obs, l].sort() })} />
                          {l}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td><button type="button" className="btn btn-sec !px-2 !py-0.5 text-xs" aria-label={`Quitar la partida ${i + 1}`} onClick={() => quitar(i)}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
