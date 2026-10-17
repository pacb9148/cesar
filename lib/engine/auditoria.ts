import { LETRAS_OBS, type LetraObs } from "../domain/constantes";
import type { Reclamacion } from "../domain/tipos";
import type { FilaCuadro } from "./filas";
import { cantidadMinima } from "./minimos";
import { porId } from "./baremo";
import type { DecisionLinea, LineaAdicional } from "../domain/tipos";

/** Una regla dura de la especificación ACAS comprobada contra el ajuste que se va a entregar. */
export type Verificacion = { codigo: string; titulo: string; ok: boolean; detalle: string[] };

export type Auditoria = {
  verificaciones: Verificacion[];
  /** true si todas las reglas duras se cumplen. */
  cumple: boolean;
  partidasReclamadas: number;
  partidasAjustadas: number;
  /** Cantidad de partidas que llevan cada letra de observación. */
  conteoObs: Record<LetraObs, number>;
};

const MAX_DETALLE = 8;
const EPS = 0.5; // un peso: tolerancia de redondeo de precios
const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

/**
 * Comprueba las prohibiciones de nivel 0 de la especificación ACAS sobre las filas ya armadas (las mismas que se imprimen):
 * la reclamación no se muta, el precio ajustado nunca supera el reclamado, ninguna partida va a 0 y toda partida tocada
 * lleva su letra de observación. Se ejecuta en pantalla y sirve de red de seguridad frente a ediciones manuales.
 */
export function auditarAjuste(filas: FilaCuadro[], reclamacion: Reclamacion): Auditoria {
  const lineas = filas.filter((f): f is Extract<FilaCuadro, { tipo: "linea" }> => f.tipo === "linea");
  const original = new Map(reclamacion.lineas.map((l) => [l.item, l]));
  const mutacion: string[] = [];
  const inflaPrecio: string[] = [];
  const inflaCantidad: string[] = [];
  const ceros: string[] = [];
  const sinLetra: string[] = [];
  const conteoObs = Object.fromEntries(LETRAS_OBS.map((l) => [l, 0])) as Record<LetraObs, number>;
  let ajustadas = 0;

  for (const f of lineas) {
    for (const o of f.obs) conteoObs[o as LetraObs]++;
    const orig = original.get(f.item);
    if (orig && f.rec && (f.rec.cantidad !== orig.cantidad || f.rec.pu !== orig.pu || f.rec.um !== orig.um || f.descripcion !== orig.descripcion))
      mutacion.push(`${f.item}: la reclamación mostrada difiere de la original.`);
    if (!f.aj) continue;
    if (f.aj.pu <= 0) ceros.push(`${f.item}: precio unitario ${f.aj.pu}.`);
    if (!f.usuario && f.aj.cantidad < cantidadMinima(f.rec?.cantidad)) ceros.push(`${f.item}: cantidad ${f.aj.cantidad} (mínimo ${cantidadMinima(f.rec?.cantidad)}).`);
    if (!f.rec) continue;
    const mismaUm = f.aj.um === f.rec.um;
    if (mismaUm && f.aj.pu > f.rec.pu + EPS) inflaPrecio.push(`${f.item}: ajustado ${pesos(f.aj.pu)} > reclamado ${pesos(f.rec.pu)}.`);
    if (mismaUm && f.aj.cantidad > f.rec.cantidad + 1e-9) inflaCantidad.push(`${f.item}: ajustado ${f.aj.cantidad} > reclamado ${f.rec.cantidad}.`);
    const cambio = !mismaUm || f.aj.cantidad !== f.rec.cantidad || Math.abs(f.aj.pu - f.rec.pu) > EPS;
    if (cambio) {
      ajustadas++;
      if (f.obs.length === 0) sinLetra.push(`${f.item}: se ajustó sin letra de observación.`);
    }
  }

  // Toda partida reclamada debe seguir en el cuadro, con su Reclamación intacta y completa.
  const enCuadro = new Set(lineas.filter((f) => f.rec).map((f) => f.item));
  const faltan = reclamacion.lineas.filter((l) => !enCuadro.has(l.item)).map((l) => `${l.item}: la partida reclamada no aparece en el cuadro.`);
  const sumaOriginal = reclamacion.lineas.reduce((s, l) => s + l.cantidad * l.pu, 0);
  const sumaCuadro = lineas.reduce((s, f) => s + (f.rec ? f.rec.cantidad * f.rec.pu : 0), 0);
  const total = Math.abs(sumaOriginal - sumaCuadro) > EPS ? [`La suma de la Reclamación del cuadro (${pesos(sumaCuadro)}) no coincide con la del presupuesto original (${pesos(sumaOriginal)}).`] : [];

  const v = (codigo: string, titulo: string, detalle: string[]): Verificacion => ({ codigo, titulo, ok: detalle.length === 0, detalle: detalle.slice(0, MAX_DETALLE) });
  const verificaciones = [
    v("ERR_MUTATION", "La reclamación del contratista no se modifica (descripción, unidad, cantidad y precio)", mutacion),
    v("ERR_COVERAGE", "Todas las partidas del presupuesto original están en el cuadro", faltan),
    v("ERR_TOTAL", "La suma de la Reclamación coincide con la del presupuesto original", total),
    v("ERR_PRICE_INFLATION", "El precio ajustado nunca supera el reclamado", inflaPrecio),
    v("ERR_ZERO_PRICE", "Ninguna partida queda en 0 salvo que el usuario lo decida: precio mayor a 0 y cantidad mínima 1", ceros),
    v("ERR_QTY_INFLATION", "La cantidad ajustada nunca supera la reclamada (misma unidad)", inflaCantidad),
    v("ERR_NO_OBS", "Toda partida ajustada lleva su letra de observación", sinLetra),
  ];
  return {
    verificaciones,
    cumple: verificaciones.every((x) => x.ok),
    partidasReclamadas: reclamacion.lineas.length,
    partidasAjustadas: ajustadas,
    conteoObs,
  };
}

/**
 * Cada precio ajustado debe poder rastrearse a una partida de la hoja Datos (baremo) o a la reclamación. Devuelve los reparos:
 * baremo que no existe, precio que no coincide con el de la hoja Datos, o precio de mercado sin partida de respaldo.
 */
export function reparosDeOrigenPrecio(decisiones: DecisionLinea[], adicionales: LineaAdicional[]): string[] {
  const reparos: string[] = [];
  const revisar = (donde: string, pu: number | null, origen: string | null) => {
    if (pu === null || origen === null) return;
    const m = /^baremo:(\d+)$/.exec(origen);
    if (m) {
      const b = porId(Number(m[1]));
      if (!b) reparos.push(`${donde}: el baremo ${m[1]} no existe en la hoja Datos.`);
      else if (Math.abs(b.pu - pu) > EPS) reparos.push(`${donde}: precio ${pesos(pu)} distinto del de la hoja Datos para «${b.descripcion}» (${pesos(b.pu)}).`);
    } else if (origen.startsWith("mercado:")) reparos.push(`${donde}: precio de mercado (${origen.slice(8)}) sin partida equivalente en la hoja Datos.`);
  };
  for (const d of decisiones) {
    if (d.accion === "ajustar") revisar(d.item, d.pu, d.pu_origen);
    d.sublineas.forEach((s, k) => revisar(`${d.item}.${k + 1}`, s.pu, s.pu_origen));
  }
  adicionales.forEach((a, k) => revisar(`adicional ${k + 1} (${a.descripcion})`, a.pu, a.pu_origen));
  return reparos;
}
