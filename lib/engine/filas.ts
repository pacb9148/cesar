import { conMinimo } from "./minimos";
import type { DatosCaso, DecisionLinea, LineaAdicional, Reclamacion, Seccion, Unidad } from "../domain/tipos";

export type EntradaFilas = {
  caso: Pick<DatosCaso, "modo">;
  reclamacion: Reclamacion;
  decisiones: DecisionLinea[];
  adicionales: LineaAdicional[];
};

/** Fila lista para pintar: contrato entre el Excel, el cuadro PNG y la pantalla (código sin dependencias de servidor). */
export type FilaCuadro =
  | { tipo: "seccion"; item: string; titulo: string }
  | {
      tipo: "linea";
      item: string;
      descripcion: string;
      rec: { um: Unidad; cantidad: number; pu: number } | null;
      aj: { um: Unidad; cantidad: number; pu: number } | null;
      obs: string[];
      /** La última edición de la partida la hizo el usuario (solo él puede dejarla en 0). */
      usuario?: boolean;
    };

/** Ordena secciones, líneas, sublíneas y adicionales en el mismo orden en que se imprimen. */
export function armarFilas(e: EntradaFilas): FilaCuadro[] {
  const secs: Seccion[] = [...e.reclamacion.secciones];
  for (const a of e.adicionales) {
    if (!secs.some((s) => s.titulo === a.seccion)) {
      secs.push({ numero: `${secs.length + 1}.0`, titulo: a.seccion });
    }
  }
  const dec = new Map(e.decisiones.map((d) => [d.item, d]));
  const filas: FilaCuadro[] = [];
  for (const s of secs) {
    filas.push({ tipo: "seccion", item: s.numero, titulo: s.titulo });
    const propias = e.reclamacion.lineas.filter((x) => x.recinto === s.titulo);
    for (const l of propias) {
      const d = dec.get(l.item);
      const rec = { um: l.um, cantidad: l.cantidad, pu: l.pu };
      if (!d) {
        filas.push({ tipo: "linea", item: l.item, descripcion: l.descripcion, rec, aj: { ...rec }, obs: ["F"] });
        continue;
      }
      if (d.accion === "desglosar") {
        filas.push({ tipo: "linea", item: l.item, descripcion: l.descripcion, rec, aj: null, obs: [] });
        d.sublineas.forEach((sl, k) =>
          filas.push({
            tipo: "linea",
            item: `${l.item}.${k + 1}`,
            descripcion: sl.descripcion,
            rec: null,
            aj: { um: sl.um, cantidad: conMinimo(sl.cantidad), pu: sl.pu },
            obs: sl.obs,
          }),
        );
        continue;
      }
      const respeta = d.accion === "respetar";
      filas.push({
        tipo: "linea",
        item: l.item,
        descripcion: l.descripcion,
        rec,
        aj: respeta
          ? { um: l.um, cantidad: l.cantidad, pu: l.pu }
          : { um: d.um ?? l.um, cantidad: d.fuente === "usuario" ? (d.cantidad ?? 0) : conMinimo(d.cantidad ?? 0, l.cantidad), pu: d.pu ?? l.pu },
        obs: respeta && d.obs.length === 0 ? ["F"] : d.obs,
        usuario: d.fuente === "usuario" || undefined,
      });
    }
    let n = propias.length;
    for (const a of e.adicionales.filter((x) => x.seccion === s.titulo)) {
      n += 1;
      filas.push({
        tipo: "linea",
        item: `${s.numero.split(".")[0]}.${n}`,
        descripcion: a.descripcion,
        rec: null,
        aj: { um: a.um, cantidad: conMinimo(a.cantidad), pu: a.pu },
        obs: a.obs,
      });
    }
  }
  return filas;
}

