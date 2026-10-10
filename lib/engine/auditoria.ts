import { LETRAS_OBS, type LetraObs } from "../domain/constantes";
import type { Reclamacion } from "../domain/tipos";
import type { FilaCuadro } from "./filas";
import { cantidadMinima } from "./minimos";

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
    if (f.aj.cantidad < cantidadMinima(f.rec?.cantidad)) ceros.push(`${f.item}: cantidad ${f.aj.cantidad} (mínimo ${cantidadMinima(f.rec?.cantidad)}).`);
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

  const v = (codigo: string, titulo: string, detalle: string[]): Verificacion => ({ codigo, titulo, ok: detalle.length === 0, detalle: detalle.slice(0, MAX_DETALLE) });
  const verificaciones = [
    v("ERR_MUTATION", "La reclamación del contratista no se modifica (descripción, unidad, cantidad y precio)", mutacion),
    v("ERR_PRICE_INFLATION", "El precio ajustado nunca supera el reclamado", inflaPrecio),
    v("ERR_ZERO_PRICE", "Ninguna partida queda en 0: precio mayor a 0 y cantidad mínima 1", ceros),
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
