"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Caso } from "@/lib/caso/repositorio";
import { LETRAS_OBS, LEYENDA, MARCADOR_FALTA_DATO } from "@/lib/domain/constantes";
import { CLAVES_CARACTERISTICAS, type LineaReclamacion, type Reclamacion, type SalidaAgente } from "@/lib/domain/tipos";
import { armarFilas, type FilaCuadro } from "@/lib/engine/filas";
import { editarDecision, estadoDe, type Cambio, type EstadoPartida } from "@/lib/engine/edicion";
import { calcularTotales } from "@/lib/engine/totales";
import { useFlujo } from "@/components/useFlujo";
import PanelTraza from "@/components/PanelTraza";
import VistaPreviaAjuste from "./VistaPreviaAjuste";
import type { AjusteGuardado } from "./PanelCaso";

const ETIQUETAS: Record<(typeof CLAVES_CARACTERISTICAS)[number], string> = {
  pisos: "Pisos", superficie_m2: "Superficie (m²)", antiguedad_anios: "Antigüedad (años)", dormitorios: "Dormitorios", banos: "Baños",
  sistema_estructural: "Edificación de", techumbre: "Techumbre soportada por", cubierta: "Cubierta", pavimentos: "Pavimentos de",
};

const n0 = (n: number) => Math.round(n).toLocaleString("es-CL");
const nc = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("es-CL", { maximumFractionDigits: 2 }));
const uf = (n: number) => n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reclamacionVacia: Reclamacion = { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 };

type Resp = { version: number; intentos: number; errores: string[]; advertencias: string[] };

export default function Ajuste({ caso, reclamacion, ajuste, iaConfigurada }: { caso: Caso; reclamacion: Reclamacion | null; ajuste: AjusteGuardado | null; iaConfigurada: boolean }) {
  const router = useRouter();
  const ia = useFlujo<Resp>(`/api/casos/${caso.id}/ajustar`);
  const [salida, setSalida] = useState<SalidaAgente | null>(ajuste?.salida ?? null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; textos: string[] } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [cerradas, setCerradas] = useState<string[]>([]);
  const recl = reclamacion ?? reclamacionVacia;
  const valorUF = Number(caso.valor_uf ?? 0);
  const dos = caso.modo === "reclamacion";

  const calc = useMemo(() => {
    if (!salida || !valorUF) return null;
    const filas = armarFilas({ caso: { modo: caso.modo }, reclamacion: recl, decisiones: salida.lineas, adicionales: salida.lineas_adicionales });
    const p = { ggPct: recl.ggPct, utilidadPct: recl.utilidadPct, ivaPct: recl.ivaPct, valorUF };
    const rec = calcularTotales(filas.flatMap((f) => (f.tipo === "linea" && f.rec ? [{ cantidad: f.rec.cantidad, pu: f.rec.pu }] : [])), p);
    const aj = calcularTotales(filas.flatMap((f) => (f.tipo === "linea" && f.aj ? [{ cantidad: f.aj.cantidad, pu: f.aj.pu }] : [])), p);
    return { filas, rec, aj };
  }, [salida, recl, valorUF, caso.modo]);

  const porItem = useMemo(() => new Map((salida?.lineas ?? []).map((l) => [l.item, l])), [salida]);
  const reclamada = useMemo(() => new Map(recl.lineas.map((l) => [l.item, l])), [recl]);

  /** Aplica una edición a una partida (incluidas las que nadie había tocado): pasa a verde. */
  function aplicar(rl: LineaReclamacion, cambio: Cambio) {
    setSalida((s) => {
      if (!s) return s;
      const actual = s.lineas.find((l) => l.item === rl.item);
      const nueva = editarDecision(rl, actual, cambio);
      return { ...s, lineas: actual ? s.lineas.map((l) => (l.item === rl.item ? nueva : l)) : [...s.lineas, nueva] };
    });
  }
  /** Mientras se escribe se conserva el texto tal cual (un campo vacío vuelve al valor reclamado al salir). */
  function escribir(rl: LineaReclamacion, campo: "cantidad" | "pu", crudo: string) {
    setBorrador((d) => ({ ...d, [`${rl.item}|${campo}`]: crudo }));
    const n = crudo === "" ? rl[campo] : Number(crudo);
    if (Number.isFinite(n) && n >= 0 && (campo === "cantidad" || n > 0)) aplicar(rl, { [campo]: n });
  }
  const soltar = (rl: LineaReclamacion, campo: "cantidad" | "pu") =>
    setBorrador((d) => {
      const { [`${rl.item}|${campo}`]: _quitado, ...resto } = d;
      void _quitado;
      return resto;
    });
  const alternar = (id: string) => setCerradas((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  // Secciones con sus partidas, para poder plegarlas y resumir su estado.
  const grupos = useMemo(() => {
    const out: { sec: Extract<FilaCuadro, { tipo: "seccion" }>; filas: Extract<FilaCuadro, { tipo: "linea" }>[] }[] = [];
    for (const f of calc?.filas ?? []) {
      if (f.tipo === "seccion") out.push({ sec: f, filas: [] });
      else out[out.length - 1]?.filas.push(f);
    }
    return out;
  }, [calc]);
  const conteo = useMemo(() => {
    const c: Record<EstadoPartida, number> = { sin_tocar: 0, ia: 0, usuario: 0 };
    for (const l of recl.lineas) c[estadoDe(porItem.get(l.item))]++;
    return c;
  }, [recl, porItem]);

  async function guardar() {
    if (!salida) return;
    setGuardando(true);
    const r = await fetch(`/api/casos/${caso.id}/ajuste`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(salida) });
    const j = (await r.json().catch(() => ({}))) as { errores?: string[]; error?: string; advertencias?: string[] };
    setGuardando(false);
    if (!r.ok) return setAviso({ tipo: "error", textos: j.errores ?? [j.error ?? "No se pudo guardar"] });
    setAviso({ tipo: "ok", textos: ["Ajuste guardado como nueva versión.", ...(j.advertencias ?? [])] });
    router.refresh();
  }

  const puedeAjustar = caso.estado !== "borrador" && (!!reclamacion || caso.modo === "perdida_determinada");

  return (
    <section className="space-y-4">
      <div className="panel space-y-3 p-5">
        <h2 className="text-lg font-semibold">Ajuste de pérdida</h2>
        <p className="texto-suave text-sm">
          El agente decide cada partida con las reglas de oro; el sistema valida y calcula los totales. La reclamación del contratista no se modifica nunca.
        </p>
        <button className="btn" disabled={ia.cargando || !puedeAjustar} onClick={() => ia.ejecutar().then((r) => r && setTimeout(() => router.refresh(), 100))}>
          {ia.cargando ? "Analizando con el agente (puede tardar unos minutos)…" : ajuste ? "Volver a ejecutar el agente" : "Ejecutar ajuste con IA"}
        </button>
        {!puedeAjustar && <p className="aviso aviso-alerta">Lee primero los documentos (paso 1).</p>}
        {!iaConfigurada && (
          <p className="aviso aviso-alerta">
            Aún no tienes ningún proveedor de IA en servicio. <Link href="/ajustes" className="underline">Ir a Ajustes de IA</Link>.
          </p>
        )}
        {ia.error && <p role="alert" className="aviso aviso-error">{ia.error}</p>}
        <PanelTraza eventos={ia.eventos} cargando={ia.cargando} titulo="Qué está haciendo el ajuste" />
        {!ia.cargando && <VistaPreviaAjuste casoId={caso.id} />}
        {ia.resultado && ia.resultado.errores.length > 0 && (
          <div role="alert" className="aviso aviso-error">
            <strong>El agente dejó {ia.resultado.errores.length} observación(es) sin corregir tras {ia.resultado.intentos} intentos:</strong>
            <ul className="mt-1 list-disc pl-5">{ia.resultado.errores.slice(0, 12).map((e, i) => (<li key={i}>{e}</li>))}</ul>
          </div>
        )}
      </div>

      {salida && calc && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi t="Reclamado" v={dos ? `UF ${uf(calc.rec.uf)}` : "—"} s={dos ? `$${n0(calc.rec.total)}` : "sin presupuesto"} />
            <Kpi t="Ajustado" v={`UF ${uf(calc.aj.uf)}`} s={`$${n0(calc.aj.total)}`} />
            <Kpi t="A indemnizar" v={`UF ${uf(calc.aj.uf - (caso.datos.poliza?.deducibleUF ?? 0))}`} s={dos && calc.rec.uf > 0 ? `${Math.round((calc.aj.uf / calc.rec.uf) * 100)} % de lo reclamado` : ""} />
          </div>

          <div className="panel overflow-x-auto p-3">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[color:var(--texto)]">
              <span className="font-semibold">Estado de cada partida:</span>
              <span><span className="marca marca-ia !ml-0">IA</span> ajustada automáticamente ({conteo.ia})</span>
              <span><span className="marca marca-sin !ml-0">Sin tocar</span> se acepta lo reclamado ({conteo.sin_tocar})</span>
              <span><span className="marca marca-usr !ml-0">Tú</span> ajustada por ti ({conteo.usuario})</span>
              <span className="ml-auto flex gap-2">
                <button type="button" className="btn btn-sec !px-2 !py-1 text-xs" onClick={() => setCerradas([])}>Expandir todo</button>
                <button type="button" className="btn btn-sec !px-2 !py-1 text-xs" onClick={() => setCerradas(grupos.map((g) => g.sec.item))}>Contraer todo</button>
              </span>
            </div>
            <table className="tabla">
              <thead>
                <tr>
                  <th rowSpan={2}>Ítem</th>
                  <th rowSpan={2} className="min-w-56 text-left">Descripción</th>
                  {dos && <th colSpan={4}>Reclamación</th>}
                  <th colSpan={4}>Ajuste</th>
                  <th rowSpan={2}>OBS</th>
                </tr>
                <tr>
                  {(dos ? [0, 1] : [0]).map((k) => (
                    <FragmentoCab key={k} />
                  ))}
                </tr>
              </thead>
              {grupos.map(({ sec, filas }) => {
                const abierta = !cerradas.includes(sec.item);
                const cuenta: Record<EstadoPartida, number> = { sin_tocar: 0, ia: 0, usuario: 0 };
                for (const f of filas) if (reclamada.has(f.item)) cuenta[estadoDe(porItem.get(f.item))]++;
                return (
                  <tbody key={sec.item}>
                    <tr className="sec">
                      <td colSpan={dos ? 11 : 7}>
                        <button type="button" aria-expanded={abierta} onClick={() => alternar(sec.item)} className="flex w-full items-center gap-2 text-left text-[color:var(--texto)]">
                          <span aria-hidden="true">{abierta ? "▾" : "▸"}</span>
                          <span>{sec.item}</span>
                          <span>{sec.titulo}</span>
                          <span className="ml-auto flex gap-1 text-xs font-normal">
                            {cuenta.ia > 0 && <span className="marca marca-ia">{cuenta.ia} IA</span>}
                            {cuenta.sin_tocar > 0 && <span className="marca marca-sin">{cuenta.sin_tocar} sin tocar</span>}
                            {cuenta.usuario > 0 && <span className="marca marca-usr">{cuenta.usuario} tuyas</span>}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {abierta &&
                      filas.map((f) => {
                        const rl = reclamada.get(f.item);
                        const dec = porItem.get(f.item);
                        const editable = !!rl && dec?.accion !== "desglosar";
                        const est: EstadoPartida = rl ? estadoDe(dec) : "ia";
                        const clase = est === "usuario" ? "fila-usr" : est === "sin_tocar" ? "fila-sin" : "fila-ia";
                        const marca = est === "usuario" ? ["marca-usr", "Tú"] : est === "sin_tocar" ? ["marca-sin", "Sin tocar"] : ["marca-ia", "IA"];
                        return (
                          <tr key={f.item} className={clase}>
                            <td className="text-center">{f.item}</td>
                            <td>
                              {f.descripcion}
                              <span className={`marca ${marca[0]}`}>{marca[1]}</span>
                              {dec?.justificacion && est !== "sin_tocar" && <div className="texto-suave text-xs">{dec.justificacion}</div>}
                            </td>
                            {dos && (f.rec ? <Valores v={f.rec} /> : <td colSpan={4} />)}
                            {f.aj ? (
                              editable && rl ? (
                                <>
                                  <td className="text-center">{f.aj.um}</td>
                                  <td><input aria-label={`Cantidad ${f.item}`} className="campo w-20 px-1 py-0.5 text-right" type="number" step="any" min="0" placeholder={String(rl.cantidad)} value={borrador[`${f.item}|cantidad`] ?? String(f.aj.cantidad)} onChange={(e) => escribir(rl, "cantidad", e.target.value)} onBlur={() => soltar(rl, "cantidad")} /></td>
                                  <td><input aria-label={`Precio unitario ${f.item}`} className="campo w-24 px-1 py-0.5 text-right" type="number" step="any" min="1" placeholder={String(rl.pu)} value={borrador[`${f.item}|pu`] ?? String(f.aj.pu)} onChange={(e) => escribir(rl, "pu", e.target.value)} onBlur={() => soltar(rl, "pu")} /></td>
                                  <td className="n">{n0(f.aj.cantidad * f.aj.pu)}</td>
                                </>
                              ) : (
                                <Valores v={f.aj} />
                              )
                            ) : (
                              <td colSpan={4} />
                            )}
                            <td className="text-center">
                              {editable && rl ? (
                                <div className="flex flex-wrap justify-center gap-1">
                                  {LETRAS_OBS.map((l) => (
                                    <label key={l} title={LEYENDA[l]} className="cursor-pointer text-xs text-[color:var(--texto)]">
                                      <input type="checkbox" className="mr-0.5" checked={f.obs.includes(l)} onChange={() => aplicar(rl, { alternar: l })} />
                                      {l}
                                    </label>
                                  ))}
                                </div>
                              ) : (
                                f.obs.join(" ")
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                );
              })}
            </table>
          </div>

          <div className="panel p-5">
            <h3 className="mb-2 font-semibold">Leyenda de observaciones</h3>
            <dl className="grid gap-1 text-sm">
              {LETRAS_OBS.map((l) => (
                <div key={l} className="flex gap-2"><dt className="w-5 font-bold">{l}</dt><dd>{LEYENDA[l]}</dd></div>
              ))}
            </dl>
          </div>

          <div className="panel space-y-3 p-5">
            <h3 className="font-semibold">Resumen del ajuste técnico aplicado</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">{salida.resumen_ajuste.map((r, i) => (<li key={i}>{r}</li>))}</ul>
          </div>

          <div className="panel space-y-3 p-5">
            <h3 className="font-semibold">Características del bien en riesgo</h3>
            <p className="texto-suave text-sm">Lo vacío sale en el informe como <strong>{MARCADOR_FALTA_DATO}</strong>. Lo deducido de fotografías figura con las fotos que lo prueban.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {CLAVES_CARACTERISTICAS.map((k) => {
                const d = salida.caracteristicas[k];
                return (
                  <div key={k}>
                    <label className="etiqueta" htmlFor={`c-${k}`}>
                      {ETIQUETAS[k]} {d.estado === "deducido" && <span className="insignia">deducido</span>} {d.estado === "faltante" && <span className="insignia">falta</span>}
                    </label>
                    <input
                      id={`c-${k}`}
                      className="campo"
                      value={d.valor ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSalida((s) => (s ? { ...s, caracteristicas: { ...s.caracteristicas, [k]: v === "" ? { valor: null, estado: "faltante", evidencia: [] } : { valor: v, estado: "extraido", evidencia: ["editado a mano"] } } } : s));
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel space-y-3 p-5">
            <h3 className="font-semibold">Evidencia observada</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {salida.evidencia_observada.map((e, i) => (
                <li key={i}><strong>{e.recinto}:</strong> {e.vineta}{e.m2_acta != null ? ` ${e.m2_acta} m² según acta.` : ""}{e.atribuible ? "" : " (no atribuible al siniestro)"}</li>
              ))}
            </ul>
            <label className="etiqueta" htmlFor="texto-ajuste">Ajuste de pérdida (texto del informe)</label>
            <textarea id="texto-ajuste" rows={5} className="campo" value={salida.ajuste_de_perdida_texto} onChange={(e) => setSalida((s) => (s ? { ...s, ajuste_de_perdida_texto: e.target.value } : s))} />
          </div>

          {aviso && (
            <div role={aviso.tipo === "error" ? "alert" : "status"} className={`aviso ${aviso.tipo === "ok" ? "aviso-ok" : "aviso-error"}`}>
              <ul className="list-disc pl-5">{aviso.textos.slice(0, 10).map((t, i) => (<li key={i}>{t}</li>))}</ul>
            </div>
          )}
          <button className="btn" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios como nueva versión"}</button>
        </>
      )}
    </section>
  );
}

function FragmentoCab() {
  return (
    <>
      <th>u/m</th><th>Cant.</th><th>P. Unit.</th><th>Total</th>
    </>
  );
}

function Valores({ v }: { v: { um: string; cantidad: number; pu: number } }) {
  return (
    <>
      <td className="text-center">{v.um}</td>
      <td className="n">{nc(v.cantidad)}</td>
      <td className="n">{n0(v.pu)}</td>
      <td className="n">{n0(v.cantidad * v.pu)}</td>
    </>
  );
}

function Kpi({ t, v, s }: { t: string; v: string; s: string }) {
  return (
    <div className="panel p-4">
      <div className="texto-suave text-xs font-semibold uppercase">{t}</div>
      <div className="text-2xl font-bold">{v}</div>
      <div className="texto-suave text-sm">{s}</div>
    </div>
  );
}
