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
import { auditarAjuste } from "@/lib/engine/auditoria";
import { useFlujo } from "@/components/useFlujo";
import PanelTraza from "@/components/PanelTraza";
import PartidasLiquidador from "./PartidasLiquidador";
import { ordenarAdicionales } from "@/lib/caso/partidas-evidencia";
import { ordenEstancias } from "@/lib/caso/textos-informe";
import type { ExtrasMemoria } from "@/lib/caso/partidas-evidencia";
import type { ActaInspeccion } from "@/lib/extraccion/acta";
import { useAccionesMenu } from "@/components/Shell";
import VistaPreviaAjuste from "./VistaPreviaAjuste";
import Previa from "./Previa";
import { redactarEvidencia } from "@/lib/caso/evidencia-parrafo";
import type { AjusteGuardado } from "./PanelCaso";
import TituloAyuda from "@/components/Ayuda";
import ValorUF from "./ValorUF";

const ETIQUETAS: Record<(typeof CLAVES_CARACTERISTICAS)[number], string> = {
  pisos: "Pisos", superficie_m2: "Superficie (m²)", antiguedad_anios: "Antigüedad (años)", dormitorios: "Dormitorios", banos: "Baños",
  sistema_estructural: "Edificación de", techumbre: "Techumbre soportada por", cubierta: "Cubierta", pavimentos: "Pavimentos de",
};

const n0 = (n: number) => Math.round(n).toLocaleString("es-CL");
const nc = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("es-CL", { maximumFractionDigits: 2 }));
const uf = (n: number) => n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reclamacionVacia: Reclamacion = { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 };

type Resp = { version: number; intentos: number; errores: string[]; advertencias: string[] };

export default function Ajuste({ caso, reclamacion, ajuste, ajusteBase, iaConfigurada, acta, extrasMemoria }: { extrasMemoria?: ExtrasMemoria; acta: ActaInspeccion | null; caso: Caso; reclamacion: Reclamacion | null; ajuste: AjusteGuardado | null; ajusteBase: SalidaAgente | null; iaConfigurada: boolean }) {
  const router = useRouter();
  const ia = useFlujo<Resp>(`/api/casos/${caso.id}/ajustar`);
  const [salida, setSalida] = useState<SalidaAgente | null>(ajuste?.salida ?? ajusteBase ?? null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; textos: string[] } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [cerradas, setCerradas] = useState<string[]>([]);
  const [previa, setPrevia] = useState<{ tipo: "excel"; salida: SalidaAgente } | null>(null);
  // Ventana de la UF: «previa» cuando se abrió porque faltaba para previsualizar el Excel (al guardarla, la previsualización continúa).
  const [ufAbierta, setUfAbierta] = useState<"editar" | "previa" | null>(null);
  const [cumplimientoAbierto, setCumplimientoAbierto] = useState(false);
  const recl = reclamacion ?? reclamacionVacia;
  const valorUF = Number(caso.valor_uf ?? 0);
  const ufTxt = (n: number) => (valorUF > 0 ? `UF ${uf(n)}` : "UF —");
  const dos = caso.modo === "reclamacion";

  const orden = useMemo(() => (acta ? ordenEstancias(caso.datos, acta) : []), [acta, caso.datos]);
  const calc = useMemo(() => {
    if (!salida) return null;
    const filas = armarFilas({ caso: { modo: caso.modo }, reclamacion: recl, decisiones: salida.lineas, adicionales: ordenarAdicionales(salida.lineas_adicionales, orden) });
    const p = { ggPct: recl.ggPct, utilidadPct: recl.utilidadPct, ivaPct: recl.ivaPct, valorUF };
    const rec = calcularTotales(filas.flatMap((f) => (f.tipo === "linea" && f.rec ? [{ cantidad: f.rec.cantidad, pu: f.rec.pu }] : [])), p);
    const aj = calcularTotales(filas.flatMap((f) => (f.tipo === "linea" && f.aj ? [{ cantidad: f.aj.cantidad, pu: f.aj.pu }] : [])), p);
    return { filas, rec, aj, auditoria: auditarAjuste(filas, recl) };
  }, [salida, recl, valorUF, caso.modo, orden]);

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
    // Ninguna partida va a 0: una cantidad menor al mínimo se lleva al mínimo al aplicarla (editarDecision).
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

  // Ejecutar y guardar viven en el menú lateral; aquí se revisan y editan las partidas.
  useAccionesMenu([
    { id: "ejecutar-ajuste", etiqueta: ia.cargando ? "Analizando con el agente…" : ajuste ? "Volver a ejecutar el agente" : "Ejecutar ajuste con IA", icono: "ejecutar", primaria: !salida, deshabilitado: ia.cargando || !puedeAjustar, onClick: () => void ia.ejecutar().then((r) => r && setTimeout(() => router.refresh(), 100)) },
    { id: "previa-excel", etiqueta: "Previsualizar Excel del ajuste", icono: "ojo", deshabilitado: !salida, onClick: () => salida && (valorUF ? setPrevia({ tipo: "excel", salida }) : setUfAbierta("previa")) },
    { id: "guardar-ajuste", etiqueta: guardando ? "Guardando…" : "Guardar ajuste como nueva versión", icono: "guardar", primaria: !!salida, deshabilitado: !salida || guardando, onClick: () => void guardar() },
  ]);

  const porRevisar = calc ? calc.auditoria.verificaciones.filter((v) => !v.ok).length : 0;
  const botonUF = (
    <button type="button" className={`btn ${valorUF ? "btn-sec" : ""}`} onClick={() => setUfAbierta("editar")}>
      Agregar/Modificar UF
    </button>
  );

  return (
    <section className="space-y-4">
      <div className="panel space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-80 space-y-3">
            <TituloAyuda titulo="Ajuste de pérdida" nivel={2}>
              <p>
                El agente decide cada partida con las reglas de oro; el sistema valida y calcula los totales. La reclamación del contratista no se modifica nunca. Ejecuta el agente y guarda tus cambios desde el menú lateral; puede tardar unos minutos.
              </p>
              {!valorUF && (
                <p>
                  <strong>Falta la UF de la fecha del siniestro.</strong> Los importes en pesos ya se ven, pero la UF, el Excel y el informe la necesitan: usa «Agregar/Modificar UF» (puedes buscarla en mindicador.cl o escribirla).
                </p>
              )}
              {salida && !ajuste && !dos && <p>No subiste un presupuesto: la plantilla base parte de las partidas que salen de la evidencia de la inspección, a precio de la hoja Datos. Edítalas, inserta las que falten y guarda para fijar esta versión.</p>}
              {salida && !ajuste && dos && <p>Se aplicó un <strong>ajuste automático con la hoja Datos</strong>: donde el contratista cobra más que el trabajo equivalente de la hoja, el precio baja al de la hoja (letra B); lo que no se reconoce con seguridad, o ya cobra menos, queda tal cual. Revisa y ajusta a mano lo que corresponda, o ejecuta el ajuste con IA desde el menú (completa lo que falte y contrasta las cantidades con el acta); luego guarda para fijar esta versión.</p>}
            </TituloAyuda>
            {ia.cargando ? botonUF : <VistaPreviaAjuste casoId={caso.id} acciones={botonUF} />}
          </div>
          {salida && calc && (
            <Resumen
              items={[
                { t: "Reclamado", v: dos ? ufTxt(calc.rec.uf) : "—", s: dos ? `$${n0(calc.rec.total)}` : "sin presupuesto" },
                { t: dos ? "Ajustado" : "Partida determinada", v: ufTxt(calc.aj.uf), s: `$${n0(calc.aj.total)}` },
                { t: "A indemnizar", v: ufTxt(calc.aj.uf - (caso.datos.poliza?.deducibleUF ?? 0)), s: dos && calc.rec.uf > 0 ? `${Math.round((calc.aj.uf / calc.rec.uf) * 100)} % de lo reclamado` : "" },
              ]}
            />
          )}
        </div>
        {!puedeAjustar && <p className="aviso aviso-alerta">Lee primero los documentos (paso «Documentos» del menú).</p>}
        {!iaConfigurada && (
          <p className="aviso aviso-alerta">
            Aún no tienes ningún proveedor de IA en servicio. <Link href="/ajustes" className="underline">Ir a Ajustes de IA</Link>.
          </p>
        )}
        {ia.error && <p role="alert" className="aviso aviso-error">{ia.error}</p>}
        <PanelTraza eventos={ia.eventos} cargando={ia.cargando} titulo="Qué está haciendo el ajuste" />
        {ia.resultado && ia.resultado.errores.length > 0 && (
          <div role="alert" className="aviso aviso-error">
            <strong>El agente dejó {ia.resultado.errores.length} observación(es) sin corregir tras {ia.resultado.intentos} intentos:</strong>
            <ul className="mt-1 list-disc pl-5">{ia.resultado.errores.slice(0, 12).map((e, i) => (<li key={i}>{e}</li>))}</ul>
          </div>
        )}
      </div>

      {salida && calc && (
        <>
          {!dos && <PartidasLiquidador extras={extrasMemoria} salida={salida} setSalida={setSalida} acta={acta} orden={orden} secciones={recl.secciones.map((s) => s.titulo)} />}

          <div className="panel space-y-3 p-5">
            <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" aria-expanded={cumplimientoAbierto} aria-controls="cumplimiento-lista" onClick={() => setCumplimientoAbierto((a) => !a)}>
              <span className="flex items-center gap-2">
                <h3 id="cumplimiento-titulo" className="font-semibold">Cumplimiento de las reglas del ajuste</h3>
                {porRevisar > 0 ? <span className="marca marca-error !ml-0">{porRevisar} por revisar</span> : <span className="marca marca-ok !ml-0">Todo cumple</span>}
              </span>
              <span className="flex items-center gap-3">
                <span className="texto-suave text-sm">{calc.auditoria.partidasReclamadas} partida(s) leída(s) del presupuesto · {calc.auditoria.partidasAjustadas} ajustada(s)</span>
                <span aria-hidden="true" className="inline-block text-lg transition-transform" style={{ transform: cumplimientoAbierto ? "rotate(180deg)" : "none" }}>▼</span>
              </span>
            </button>
            {cumplimientoAbierto && (
              <div id="cumplimiento-lista" className="space-y-3">
                <ul className="space-y-1 text-sm">
                  {calc.auditoria.verificaciones.map((v) => (
                    <li key={v.codigo}>
                      <span className={`marca ${v.ok ? "marca-ok" : "marca-error"} !ml-0`}>{v.ok ? "Cumple" : "Revisar"}</span> <code className="text-xs">{v.codigo}</code> {v.titulo}
                      {!v.ok && <ul className="ml-6 mt-1 list-disc text-xs">{v.detalle.map((d, i) => (<li key={i}>{d}</li>))}</ul>}
                    </li>
                  ))}
                </ul>
                <p className="texto-suave text-xs">
                  Partidas por observación:{" "}
                  {LETRAS_OBS.map((l) => (
                    <span key={l} className="mr-2" title={LEYENDA[l]}><strong>{l}</strong> {calc.auditoria.conteoObs[l]}</span>
                  ))}
                </p>
              </div>
            )}
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
                  <th colSpan={4}>{dos ? "Ajuste" : "Partida determinada"}</th>
                  {dos && <th rowSpan={2}>OBS</th>}
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
                      <td colSpan={dos ? 11 : 6}>
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
                            {dos && (
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
                                f.obs.filter((o) => o !== "F").join(" ")
                              )}
                            </td>
                            )}
                          </tr>
                        );
                      })}
                  </tbody>
                );
              })}
            </table>
          </div>

          {dos && <PartidasLiquidador extras={extrasMemoria} salida={salida} setSalida={setSalida} acta={acta} orden={orden} secciones={recl.secciones.map((s) => s.titulo)} />}

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
            <TituloAyuda titulo="Características del bien en riesgo" nivel={3}>
              <p>Lo vacío sale en el informe como <strong>{MARCADOR_FALTA_DATO}</strong>. Lo deducido de fotografías figura con las fotos que lo prueban.</p>
            </TituloAyuda>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Evidencia observada</h3>
              <button type="button" className="btn btn-sec !px-3 !py-1 text-sm" disabled={!salida.evidencia_observada.length} onClick={() => setSalida((s) => (s ? { ...s, evidencia_texto: redactarEvidencia(s.evidencia_observada) } : s))} title="Convierte las viñetas por recinto en un solo párrafo coherente y profesional para el informe">Generar párrafo</button>
            </div>
            <ul className="space-y-2 text-sm">
              {salida.evidencia_observada.map((e, i) => (
                <li key={i} className="list-none">
                  {/* Especificación ACAS: el recinto en Times New Roman 12 pt, subrayado y cursiva, y debajo el daño en texto plano. */}
                  <span style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: "12pt" }}><u><i>{e.recinto}</i></u></span>
                  <div>{e.vineta}{e.m2_acta != null ? ` ${e.m2_acta} m² según acta.` : ""}{e.atribuible ? "" : " (no atribuible al siniestro)"}</div>
                </li>
              ))}
            </ul>
            {salida.evidencia_texto !== undefined && (
              <div className="space-y-1">
                <label className="etiqueta" htmlFor="texto-evidencia">Párrafo de evidencia observada (el informe usa este párrafo en lugar de la lista)</label>
                <textarea id="texto-evidencia" rows={5} className="campo" value={salida.evidencia_texto} onChange={(e) => setSalida((s) => (s ? { ...s, evidencia_texto: e.target.value } : s))} />
                <button type="button" className="btn btn-sec !px-3 !py-1 text-sm" onClick={() => setSalida((s) => { if (!s) return s; const { evidencia_texto: _t, ...resto } = s; void _t; return resto; })}>Volver a la lista por recinto</button>
              </div>
            )}
            <label className="etiqueta" htmlFor="texto-ajuste">Ajuste de pérdida (texto del informe)</label>
            <textarea id="texto-ajuste" rows={5} className="campo" value={salida.ajuste_de_perdida_texto} onChange={(e) => setSalida((s) => (s ? { ...s, ajuste_de_perdida_texto: e.target.value } : s))} />
          </div>

          {aviso && (
            <div role={aviso.tipo === "error" ? "alert" : "status"} className={`aviso ${aviso.tipo === "ok" ? "aviso-ok" : "aviso-error"}`}>
              <ul className="list-disc pl-5">{aviso.textos.slice(0, 10).map((t, i) => (<li key={i}>{t}</li>))}</ul>
            </div>
          )}
        </>
      )}
      {ufAbierta && (
        <ValorUF
          casoId={caso.id}
          valor={valorUF}
          fecha={caso.datos.fechas?.ocurrencia ?? ""}
          motivo={ufAbierta === "previa" ? "Falta la UF de la fecha del siniestro para previsualizar el Excel. Agrégala y la previsualización se abre sola." : undefined}
          onCerrar={() => setUfAbierta(null)}
          onGuardada={() => {
            const siguiente = ufAbierta;
            setUfAbierta(null);
            if (siguiente === "previa" && salida) setPrevia({ tipo: "excel", salida });
            router.refresh();
          }}
        />
      )}
      {previa && <Previa casoId={caso.id} cuerpo={previa} titulo="Excel del ajuste (vista previa)" onCerrar={() => setPrevia(null)} />}
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

function Resumen({ items }: { items: { t: string; v: string; s: string }[] }) {
  return (
    <div role="group" aria-label="Resumen del ajuste" className="panel grid w-full max-w-full grid-cols-3 gap-4 p-4 sm:w-auto">
      {items.map((i) => (
        <div key={i.t}>
          <div className="texto-suave text-xs font-semibold uppercase">{i.t}</div>
          <div className="text-xl font-bold">{i.v}</div>
          <div className="texto-suave text-sm">{i.s}</div>
        </div>
      ))}
    </div>
  );
}
