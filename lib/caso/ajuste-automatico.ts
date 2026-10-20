import type { DecisionLinea, LineaReclamacion, Unidad } from "../domain/tipos";
import type { Aprendido } from "../conocimiento";
import { completarConRespeto, decidirLinea, type Clasificacion, type ContextoLinea } from "../ia/motor-ajuste";
import type { Reclamacion } from "../domain/tipos";
import { mejorEquivalente } from "./equivalencias";
import { etiquetasDe } from "./relacion-partidas";

/**
 * Ajuste automático con la hoja Datos (sin IA). Contrasta cada partida del presupuesto con su equivalente de la hoja Datos: si el precio del contratista
 * es mayor, lo lleva al de la hoja (letra B); si la partida no se reconoce con seguridad, o el precio del contratista ya es menor o igual, se deja TAL CUAL:
 * nunca se inventa un valor ni se sube nada. La cantidad solo se acota a la medición física del recinto (cielo, paño de muro, piso) cuando la excede.
 */

const UNIDADES: readonly Unidad[] = ["m2", "ml", "gl", "un", "m3", "kg"];
const unidadDe = (um: string): Unidad | undefined => UNIDADES.find((u) => u === um);

/** Medida contra la que se acota la cantidad: la superficie física del elemento en ese recinto; sin medición o en otra unidad, se deja la reclamada. */
export function baseSegura(l: LineaReclamacion, ctx: ContextoLinea): Clasificacion["base"] {
  if (l.um !== "m2" || !ctx.cub) return "reclamada";
  const { objetos } = etiquetasDe(l.descripcion);
  if (objetos.has("cielo") && ctx.cub.cielo > 0) return "cielo";
  if (objetos.has("muro") && ctx.cub.pano > 0) return "pano";
  if (objetos.has("piso") && ctx.cub.piso > 0) return "piso";
  return "reclamada";
}

/** Clasificación segura por equivalencia de confianza alta; null si la partida no se reconoce (entonces se respeta). */
export function clasificacionPorEquivalencia(l: LineaReclamacion, ctx: ContextoLinea, memoria?: Aprendido): Clasificacion | null {
  const eq = mejorEquivalente(l.descripcion, { um: unidadDe(l.um), memoria });
  if (!eq) return null;
  return { item: l.item, categoria: "ajustar", baremo_id: eq.id, base: baseSegura(l, ctx), um_ajuste: null, baremo_id_pintura: null };
}

export type ResultadoAutomatico = { lineas: DecisionLinea[]; reconocidas: number; ajustadas: number };

/**
 * Decisión de cada partida del presupuesto con el ajuste automático. Toda partida queda con decisión (las no reconocidas, «respetar»).
 * `contexto` entrega las medidas del recinto de cada partida (lo calcula quien llama, a partir del acta, para no depender del agente).
 */
export function ajusteAutomatico(e: { reclamacion: Reclamacion; memoria?: Aprendido }, contexto: (l: LineaReclamacion) => ContextoLinea): ResultadoAutomatico {
  const decisiones: DecisionLinea[] = [];
  let reconocidas = 0;
  for (const l of e.reclamacion.lineas) {
    const ctx = contexto(l);
    const c = clasificacionPorEquivalencia(l, ctx, e.memoria);
    if (!c) continue;
    reconocidas++;
    const d = decidirLinea(l, c, ctx).decision;
    if (d.accion !== "respetar") decisiones.push(d);
  }
  return { lineas: completarConRespeto(e.reclamacion.lineas, decisiones), reconocidas, ajustadas: decisiones.length };
}

/**
 * Completa la clasificación de una partida que dejó la IA: si no hay partida de la hoja Datos, o la IA la dio por buena («respetar») y existe una equivalente
 * segura de menor precio, manda la hoja Datos. Devuelve de dónde salió para poder avisar cuántas decisiones cambió.
 */
export function completarClasificacion(l: LineaReclamacion, c0: Clasificacion | undefined, ctx: ContextoLinea, memoria?: Aprendido): { c: Clasificacion | null; origen: "ia" | "equivalencia" | "sobreescrita" | "ninguna" } {
  const eq = mejorEquivalente(l.descripcion, { um: unidadDe(l.um), memoria });
  if (!c0) return eq ? { c: clasificacionPorEquivalencia(l, ctx, memoria), origen: "equivalencia" } : { c: null, origen: "ninguna" };
  if (c0.categoria === "respetar") {
    if (eq && eq.pu < l.pu) return { c: { ...c0, categoria: "ajustar", baremo_id: eq.id, base: baseSegura(l, ctx) }, origen: "sobreescrita" };
    return { c: c0, origen: "ia" };
  }
  if (c0.categoria === "ajustar" && c0.baremo_id == null && eq) return { c: { ...c0, baremo_id: eq.id }, origen: "equivalencia" };
  return { c: c0, origen: "ia" };
}
