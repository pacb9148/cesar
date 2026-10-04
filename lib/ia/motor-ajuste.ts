import { z } from "zod";
import { CANTIDAD_PREVENTIVA, PLANCHA_M2 } from "../domain/constantes";
import { unidadSchema, type DecisionLinea, type LineaReclamacion, type Sublinea, type Unidad } from "../domain/tipos";
import { candidatos, porId } from "../engine/baremo";
import type { Cubicacion } from "../engine/cubicacion";

/**
 * Motor determinista del ajuste. El modelo NO decide cifras: por cada partida solo la clasifica (qué tipo de partida es, qué
 * precio de baremo le corresponde y contra qué medida se contrasta la cantidad). Aquí se contrasta lo presupuestado con el
 * máximo permitido (baremo para el precio, medición del acta para la cantidad) y se ajusta solo si lo reclamado lo excede.
 */

export const CATEGORIAS = ["respetar", "ajustar", "desglosar", "absorbida", "ajena", "preventiva"] as const;
export const BASES = ["reclamada", "acta_m2", "muro_neto", "pano", "cielo", "piso", "ml", "plancha"] as const;

export const clasificacionSchema = z.object({
  item: z.string(),
  categoria: z.enum(CATEGORIAS),
  baremo_id: z.number().int().nullable(),
  base: z.enum(BASES),
  um_ajuste: unidadSchema.nullable(),
  baremo_id_pintura: z.number().int().nullable(),
});
export type Clasificacion = z.infer<typeof clasificacionSchema>;
export const loteSchema = z.object({ decisiones: z.array(clasificacionSchema) });

export type ContextoLinea = { cub: Cubicacion | null; m2Acta: number | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

const MEDIDA: Record<Exclude<(typeof BASES)[number], "reclamada" | "acta_m2" | "plancha">, keyof Cubicacion> = {
  muro_neto: "muroNeto",
  pano: "pano",
  cielo: "cielo",
  piso: "piso",
  ml: "ml",
};

/** Máximo permitido de cantidad para la base elegida; null si la medida no existe para ese recinto. */
function medida(base: Clasificacion["base"], l: LineaReclamacion, ctx: ContextoLinea): number | null {
  if (base === "reclamada") return l.cantidad;
  if (base === "plancha") return PLANCHA_M2;
  if (base === "acta_m2") return ctx.m2Acta;
  const v = ctx.cub?.[MEDIDA[base]];
  return v && v > 0 ? v : null;
}

/** Clasificación por defecto cuando el modelo no la entrega: la más conservadora (precio al baremo más parecido, cantidad reclamada). */
export function clasificacionPorDefecto(l: LineaReclamacion): Clasificacion {
  return { item: l.item, categoria: "ajustar", baremo_id: candidatos(l.descripcion, 1)[0]?.id ?? null, base: "reclamada", um_ajuste: null, baremo_id_pintura: null };
}

export type Decidida = { decision: DecisionLinea; aviso?: string };

const respetar = (l: LineaReclamacion): DecisionLinea => ({
  item: l.item,
  accion: "respetar",
  um: l.um,
  cantidad: l.cantidad,
  pu: l.pu,
  pu_origen: "reclamacion",
  obs: ["F"],
  justificacion: "Se respeta lo reclamado por estar acorde a mercado y a la declaración original.",
  sublineas: [],
});

function sublinea(descripcion: string, um: Unidad, cantidad: number, baremoId: number, obs: Sublinea["obs"], justificacion: string): Sublinea | null {
  const b = porId(baremoId);
  if (!b) return null;
  return { descripcion, um, cantidad: r2(cantidad), pu: b.pu, pu_origen: `baremo:${b.id}`, obs, justificacion };
}

/** Partida agrupada: se deja en blanco y se desglosa en recambio estructural (m² dañados del acta) y pintura (paño completo). */
function desglosar(l: LineaReclamacion, c: Clasificacion, ctx: ContextoLinea): DecisionLinea | null {
  const estructural = c.baremo_id ?? candidatos(l.descripcion, 1)[0]?.id;
  const pintura = c.baremo_id_pintura ?? candidatos("pintura latex muros", 1)[0]?.id;
  if (estructural == null || pintura == null) return null;
  const mEstruct = ctx.m2Acta ?? l.cantidad;
  const mPintura = ctx.cub?.pano ?? ctx.m2Acta ?? l.cantidad;
  const a = sublinea(`Reparación estructural: ${l.descripcion}`, "m2", mEstruct, estructural, ["B", "C"], "Recambio acotado a los m² dañados del acta, a precio de baremo a todo costo.");
  const b = sublinea(`Terminación y pintura: ${l.descripcion}`, "m2", mPintura, pintura, ["B", "C"], "Pintura sobre el paño completo para evitar parches, a precio de baremo a todo costo.");
  if (!a || !b) return null;
  return { item: l.item, accion: "desglosar", um: null, cantidad: null, pu: null, pu_origen: null, obs: [], justificacion: "Partida agrupada: se desglosa en recambio estructural y pintura.", sublineas: [a, b] };
}

/** Contrasta una partida con sus máximos y devuelve la decisión final. Nunca lanza: lo que no se puede calcular se respeta y se avisa. */
export function decidirLinea(l: LineaReclamacion, c: Clasificacion, ctx: ContextoLinea): Decidida {
  const baremo = c.baremo_id != null ? porId(c.baremo_id) : undefined;
  if (c.categoria === "respetar") return { decision: respetar(l) };

  if (c.categoria === "desglosar") {
    const d = desglosar(l, c, ctx);
    if (d) return { decision: d };
    return { decision: respetar(l), aviso: `Partida ${l.item}: no se pudo desglosar (falta baremo); se respetó lo reclamado.` };
  }

  // Precio: solo se baja al máximo del baremo; si cambia la unidad (lista de supermercado → m²/ml instalados) manda el baremo.
  const umDestino = c.um_ajuste && baremo ? c.um_ajuste : l.um;
  const mismaUm = umDestino === l.um;
  let pu = l.pu;
  let origen = "reclamacion";
  if (baremo && (l.pu <= 0 || !mismaUm || baremo.pu < pu)) {
    pu = baremo.pu;
    origen = `baremo:${baremo.id}`;
  }
  const precioCambia = origen !== "reclamacion";

  if (c.categoria === "absorbida") return { decision: { item: l.item, accion: "ajustar", um: l.um, cantidad: 0, pu, pu_origen: origen, obs: ["E"], justificacion: "Actividad absorbida en gastos generales o en partidas a todo costo.", sublineas: [] } };
  if (c.categoria === "ajena") return { decision: { item: l.item, accion: "ajustar", um: l.um, cantidad: 0, pu, pu_origen: origen, obs: ["A"], justificacion: "Daño por mantenimiento o deterioro progresivo, ajeno al evento.", sublineas: [] } };
  if (c.categoria === "preventiva") {
    const cant = Math.min(l.cantidad, CANTIDAD_PREVENTIVA);
    return { decision: { item: l.item, accion: "ajustar", um: l.um, cantidad: cant, pu, pu_origen: origen, obs: ["D"], justificacion: "No se registran daños en esa magnitud en el acta: se deja la cantidad mínima preventiva.", sublineas: [] } };
  }

  // Cantidad: tope = medida elegida. En la misma unidad nunca se sube lo reclamado; al convertir de unidad la medida es la cantidad.
  const tope = medida(c.base, l, ctx);
  let aviso: string | undefined;
  let cantidad = l.cantidad;
  let umFinal: Unidad = l.um;
  if (mismaUm) {
    if (tope != null) cantidad = Math.min(l.cantidad, r2(tope));
    else if (c.base !== "reclamada") aviso = `Partida ${l.item}: no hay medición para «${c.base}»; se mantuvo la cantidad reclamada.`;
  } else if (tope != null) {
    cantidad = r2(tope);
    umFinal = umDestino;
  } else {
    pu = l.pu;
    origen = "reclamacion";
    aviso = `Partida ${l.item}: no hay medición para convertir la unidad; se mantuvo lo reclamado.`;
  }
  const cantidadCambia = Math.abs(cantidad - l.cantidad) > 1e-9 || umFinal !== l.um;
  const precioFinalCambia = origen !== "reclamacion" && (precioCambia || !mismaUm);
  if (!cantidadCambia && !precioFinalCambia) return { decision: respetar(l), aviso };
  const obs: DecisionLinea["obs"] = [...(precioFinalCambia ? (["B"] as const) : []), ...(cantidadCambia ? (["C"] as const) : [])];
  const justificacion = [precioFinalCambia ? "Precio unitario llevado al máximo del baremo a todo costo." : "", cantidadCambia ? "Cantidad acotada a la medición del acta o al mínimo técnico." : ""].filter(Boolean).join(" ");
  return { decision: { item: l.item, accion: "ajustar", um: umFinal, cantidad: r2(cantidad), pu, pu_origen: origen, obs, justificacion, sublineas: [] }, aviso };
}
