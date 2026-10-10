import { FRASES_PROHIBIDAS, MARCADOR_FALTA_DATO } from "../domain/constantes";
import type { Reclamacion, SalidaAgente } from "../domain/tipos";
import { porId } from "../engine/baremo";
import { cantidadMinima } from "../engine/minimos";

export type ResultadoValidacion = { errores: string[]; advertencias: string[] };

export type ContextoValidacion = {
  reclamacion: Reclamacion;
  fotosIds: Set<string>;
  /** Fuentes de precios de mercado entregadas al agente (texto tras "mercado:"). */
  fuentesMercado: Set<string>;
  modo: "reclamacion" | "perdida_determinada";
};

const textos = (s: SalidaAgente): string[] => [
  s.ajuste_de_perdida_texto,
  ...s.resumen_ajuste,
  ...s.evidencia_observada.map((e) => e.vineta),
  ...s.lineas.flatMap((l) => [l.justificacion, ...l.sublineas.map((x) => x.justificacion)]),
  ...s.lineas_adicionales.map((l) => l.justificacion),
];

function validarPrecio(origen: string, pu: number, puReclamo: number | null, ctx: ContextoValidacion, donde: string, e: string[], w: string[]) {
  if (origen === "reclamacion") {
    if (puReclamo != null && Math.abs(pu - puReclamo) > 0.5) e.push(`${donde}: el precio dice "reclamacion" pero ${pu} ≠ ${puReclamo}.`);
  } else if (origen.startsWith("baremo:")) {
    const it = porId(Number(origen.slice(7)));
    if (!it) e.push(`${donde}: el id de baremo ${origen} no existe.`);
    else if (Math.abs(it.pu - pu) > 0.5) e.push(`${donde}: el precio ${pu} no coincide con el baremo ${it.id} (${it.pu}).`);
  } else if (origen.startsWith("mercado:")) {
    const fuente = origen.slice(8);
    if (!ctx.fuentesMercado.has(fuente)) e.push(`${donde}: fuente de mercado "${fuente}" no fue entregada al agente.`);
    else w.push(`${donde}: precio de mercado (${fuente}); confirmar.`);
  }
}

/** Reglas que el agente no puede romper: si fallan, se pide corrección con este mismo texto. */
export function validarSalida(s: SalidaAgente, ctx: ContextoValidacion): ResultadoValidacion {
  const errores: string[] = [];
  const advertencias: string[] = [];
  const reclamo = new Map(ctx.reclamacion.lineas.map((l) => [l.item, l]));

  if (ctx.modo === "reclamacion") {
    const vistos = new Set<string>();
    for (const l of s.lineas) {
      if (vistos.has(l.item)) errores.push(`La partida ${l.item} aparece más de una vez.`);
      vistos.add(l.item);
      if (!reclamo.has(l.item)) errores.push(`La partida ${l.item} no existe en la reclamación.`);
    }
    // Una partida sin decisión no es un error: se acepta lo reclamado (la completa el sistema antes de guardar).
  } else if (s.lineas.length) errores.push("En pérdida determinada no hay partidas de reclamación que ajustar.");

  for (const l of s.lineas) {
    const d = `Partida ${l.item}`;
    const rc = reclamo.get(l.item);
    if (l.accion === "desglosar") {
      if (l.cantidad != null || l.pu != null) errores.push(`${d}: una partida desglosada queda en blanco en Ajuste.`);
      if (l.sublineas.length < 2) errores.push(`${d}: el desglose lleva al menos 2 sub-líneas (recambio estructural y pintura).`);
      for (const [i, sl] of l.sublineas.entries()) {
        validarPrecio(sl.pu_origen, sl.pu, null, ctx, `${d} sub-línea ${i + 1}`, errores, advertencias);
        if (sl.cantidad < 1) errores.push(`${d} sub-línea ${i + 1}: ninguna partida va a 0, la cantidad mínima es 1.`);
      }
      continue;
    }
    if (l.cantidad == null || l.pu == null || l.um == null || l.pu_origen == null) {
      errores.push(`${d}: faltan unidad, cantidad, precio u origen del precio.`);
      continue;
    }
    if (l.obs.length === 0) errores.push(`${d}: toda partida ajustada lleva al menos una letra de observación.`);
    if (l.pu <= 0) errores.push(`${d}: el precio unitario nunca va a 0.`);
    if (l.fuente !== "usuario" && l.cantidad < cantidadMinima(rc?.cantidad)) errores.push(`${d}: ninguna partida va a 0, la cantidad mínima es ${cantidadMinima(rc?.cantidad)}.`);
    if (l.obs.includes("F")) {
      if (l.obs.length > 1) errores.push(`${d}: F (se respeta lo reclamado) no se combina con otras letras.`);
      if (rc && (Math.abs(l.cantidad - rc.cantidad) > 1e-9 || Math.abs(l.pu - rc.pu) > 0.5))
        errores.push(`${d}: con F la cantidad y el precio deben ser los reclamados (${rc.cantidad} × ${rc.pu}).`);
    }
    if (l.accion === "respetar" && rc && (l.cantidad !== rc.cantidad || l.pu !== rc.pu)) errores.push(`${d}: "respetar" exige repetir la cantidad y el precio reclamados.`);
    validarPrecio(l.pu_origen, l.pu, rc?.pu ?? null, ctx, d, errores, advertencias);
    if (rc && l.cantidad > rc.cantidad + 1e-9 && l.accion !== "respetar") advertencias.push(`${d}: el ajuste (${l.cantidad}) supera lo reclamado (${rc.cantidad}).`);
  }
  for (const a of s.lineas_adicionales) validarPrecio(a.pu_origen, a.pu, null, ctx, `Línea adicional "${a.descripcion}"`, errores, advertencias);

  for (const t of textos(s)) {
    const baja = t.toLowerCase();
    for (const f of FRASES_PROHIBIDAS) if (baja.includes(f)) errores.push(`Frase prohibida "${f}" en: "${t.slice(0, 80)}…"`);
  }

  for (const [k, d] of Object.entries(s.caracteristicas)) {
    if (d.estado === "faltante" && d.valor != null) errores.push(`Característica ${k}: "faltante" debe llevar valor null.`);
    if (d.estado !== "faltante" && (d.valor == null || d.valor === "")) errores.push(`Característica ${k}: sin valor, debe marcarse "faltante".`);
    if (d.estado === "deducido") {
      if (d.evidencia.length === 0) errores.push(`Característica ${k}: lo deducido de fotos cita sus fotos.`);
      for (const f of d.evidencia) if (!ctx.fotosIds.has(f)) errores.push(`Característica ${k}: la foto ${f} no existe.`);
    }
    if (typeof d.valor === "string" && d.valor.includes(MARCADOR_FALTA_DATO)) errores.push(`Característica ${k}: el marcador lo pone el sistema, no el modelo.`);
  }
  for (const ev of s.evidencia_observada) for (const f of ev.fotos) if (!ctx.fotosIds.has(f)) errores.push(`Evidencia "${ev.recinto}": la foto ${f} no existe.`);

  if (s.resumen_ajuste.length < 3 || s.resumen_ajuste.length > 4) errores.push("El resumen del ajuste lleva 3 o 4 viñetas.");
  return { errores, advertencias };
}
