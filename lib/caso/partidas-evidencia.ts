import type { LineaAdicional } from "../domain/tipos";
import type { ActaInspeccion } from "../extraccion/acta";
import { porId } from "../engine/baremo";
import { cubicar } from "../engine/cubicacion";

/** Partidas del baremo (hoja Datos) que reparan cada elemento afectado: preparación de superficie, empaste y lijado, y pintura. */
const POR_ELEMENTO: Record<"cielo" | "muro", { ids: number[]; etiqueta: string }> = {
  cielo: { ids: [2, 3, 37], etiqueta: "cielo" },
  muro: { ids: [6, 7, 46], etiqueta: "muros" },
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Elementos afectados que nombra la descripción del daño, en el orden en que aparecen. */
function elementosDe(descripcion: string): ("cielo" | "muro")[] {
  const d = descripcion.toLowerCase();
  return (
    [
      ["cielo", d.search(/cielo/)],
      ["muro", d.search(/pared|muro|tabique/)],
    ] as const
  )
    .filter(([, pos]) => pos >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([e]) => e);
}

export type PartidasDeEvidencia = { partidas: LineaAdicional[]; sinPartida: string[] };

/**
 * Convierte la evidencia de la inspección (tabla «Daños y perjuicios») en partidas de liquidación a precio de baremo: por cada elemento afectado
 * (cielo, muros) la preparación de superficie, el empaste y lijado y la pintura, con la cantidad de la medición del acta (si el daño toca
 * cielo y muros, se reparte según la cubicación del recinto). Los daños de otro tipo no tienen partida automática y quedan en `sinPartida`.
 */
export function partidasDeEvidencia(acta: Pick<ActaInspeccion, "danos">): PartidasDeEvidencia {
  const partidas: LineaAdicional[] = [];
  const sinPartida: string[] = [];
  for (const d of acta.danos) {
    const elementos = elementosDe(d.descripcion);
    if (elementos.length === 0) {
      sinPartida.push(`${d.recinto}: «${d.descripcion}» no tiene partida automática; agrégala a mano.`);
      continue;
    }
    const cub = cubicar({ alto: d.alto, largo: d.largo, ancho: d.ancho });
    const peso = (e: "cielo" | "muro") => (e === "cielo" ? cub.cielo : cub.muroNeto);
    const total = elementos.reduce((s, e) => s + peso(e), 0);
    const seccion = d.recinto.trim().toUpperCase();
    for (const e of elementos) {
      const cantidad = Math.max(1, r2(elementos.length === 1 || total <= 0 ? d.cantidad : (d.cantidad * peso(e)) / total));
      for (const id of POR_ELEMENTO[e].ids) {
        const b = porId(id);
        if (!b) continue;
        partidas.push({
          seccion,
          descripcion: b.descripcion,
          um: "m2",
          cantidad,
          pu: b.pu,
          pu_origen: `baremo:${b.id}`,
          obs: ["B", "C"],
          justificacion: `Reparación del daño observado en ${POR_ELEMENTO[e].etiqueta} del recinto (${d.cantidad} m² según acta), a precio de baremo a todo costo.`,
        });
      }
    }
  }
  return { partidas, sinPartida };
}
