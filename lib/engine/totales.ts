import { IVA } from "../domain/constantes";
import type { Reclamacion } from "../domain/tipos";

export type LineaValorada = { cantidad: number | null; pu: number | null };

export type Totales = {
  directo: number;
  gastosGenerales: number;
  utilidades: number;
  neto: number;
  iva: number;
  total: number;
  uf: number;
};

export type ParametrosTotales = {
  ggPct: number;
  utilidadPct: number;
  ivaPct?: number;
  valorUF: number;
};

export const totalLinea = (l: LineaValorada) =>
  l.cantidad != null && l.pu != null ? l.cantidad * l.pu : 0;

/** Cálculo idéntico a la hoja EDIFICIO: directo → GG(+utilidad) → neto → IVA → UF. */
export function calcularTotales(lineas: LineaValorada[], p: ParametrosTotales): Totales {
  const directo = lineas.reduce((s, l) => s + totalLinea(l), 0);
  const gastosGenerales = directo * p.ggPct;
  const utilidades = directo * p.utilidadPct;
  const neto = directo + gastosGenerales + utilidades;
  const iva = neto * (p.ivaPct ?? IVA);
  const total = neto + iva;
  return { directo, gastosGenerales, utilidades, neto, iva, total, uf: total / p.valorUF };
}

export function totalesReclamacion(r: Reclamacion, valorUF: number): Totales {
  return calcularTotales(r.lineas, {
    ggPct: r.ggPct,
    utilidadPct: r.utilidadPct,
    ivaPct: r.ivaPct,
    valorUF,
  });
}
