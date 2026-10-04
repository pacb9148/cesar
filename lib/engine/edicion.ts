import type { LetraObs } from "../domain/constantes";
import type { DecisionLinea, LineaReclamacion } from "../domain/tipos";
import { decisionRespetar } from "../ia/motor-ajuste";

/** Quién dejó la partida como está: nadie (se acepta lo reclamado), el sistema con IA, o el usuario a mano. */
export type EstadoPartida = "sin_tocar" | "ia" | "usuario";

export function estadoDe(d: DecisionLinea | undefined): EstadoPartida {
  if (!d) return "sin_tocar";
  if (d.fuente === "usuario") return "usuario";
  return d.accion === "respetar" ? "sin_tocar" : "ia";
}

export type Cambio = { cantidad?: number; pu?: number; alternar?: LetraObs };

/**
 * Aplica una edición del usuario a una partida (también a las que nadie había tocado) y deja la decisión coherente con las reglas:
 * B y C se marcan solas según lo que cambió, F es exclusiva y devuelve los valores reclamados, y toda edición queda como «usuario».
 */
export function editarDecision(rec: LineaReclamacion, actual: DecisionLinea | undefined, c: Cambio): DecisionLinea {
  const base = actual ?? decisionRespetar(rec);
  const um = base.um ?? rec.um;
  const cantidad = c.cantidad ?? base.cantidad ?? rec.cantidad;
  const pu = c.pu !== undefined && c.pu > 0 ? c.pu : (base.pu ?? rec.pu);
  const origenBase = base.pu_origen ?? "reclamacion";
  const pu_origen = c.pu !== undefined ? (pu === rec.pu ? "reclamacion" : "mercado:manual") : origenBase;

  let obs: LetraObs[] = base.obs.filter((o) => o !== "F");
  if (c.alternar) {
    obs = c.alternar === "F" ? ["F"] : obs.includes(c.alternar) ? obs.filter((o) => o !== c.alternar) : [...obs, c.alternar].sort();
  } else {
    obs = obs.filter((o) => o !== "B" && o !== "C");
    if (pu !== rec.pu) obs.push("B");
    if (cantidad !== rec.cantidad) obs.push("C");
    obs.sort();
  }
  const sinCambios = pu === rec.pu && cantidad === rec.cantidad && um === rec.um;
  if (obs.length === 0 && sinCambios) obs = ["F"];
  if (obs.includes("F")) return { ...decisionRespetar(rec), justificacion: base.justificacion, fuente: "usuario" };
  return { item: rec.item, accion: "ajustar", um, cantidad, pu, pu_origen, obs, justificacion: actual?.justificacion || "Ajuste manual del usuario.", sublineas: [], fuente: "usuario" };
}
