import type { DatosCaso, EvidenciaRecinto, SalidaAgente } from "../domain/tipos";
import type { ActaInspeccion } from "../extraccion/acta";
import { modernizarEvidencia, parrafoInmueble } from "./parrafo-inmueble";

/** Evidencia como líneas editables: «Recinto: texto», una por viñeta. */
export const textoDeEvidencia = (ev: Pick<EvidenciaRecinto, "recinto" | "vineta">[]): string => ev.map((e) => (e.recinto ? `${e.recinto}: ${e.vineta}` : e.vineta)).join("\n");

/** Líneas editadas → viñetas. Lo que va antes de los primeros «:» es el recinto (si es corto); una línea sin recinto se conserva como viñeta suelta. */
export function evidenciaDeTexto(t: string): EvidenciaRecinto[] {
  return t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(":");
      const recinto = i > 0 && i <= 40 ? l.slice(0, i).trim() : "";
      return { recinto, vineta: (recinto ? l.slice(i + 1) : l).trim(), m2_acta: null, atribuible: true, fotos: [] };
    });
}

export type TextosInforme = { caracteristicas: string; evidencia: EvidenciaRecinto[] };

/** Lo que va al informe: el texto que editó el usuario en «Datos» o, si no hay, el que sale de la inspección y del ajuste. */
export function textosDelInforme(datos: Pick<DatosCaso, "textos">, acta: ActaInspeccion, salida: Pick<SalidaAgente, "evidencia_observada">): TextosInforme {
  const propios = datos.textos;
  return {
    caracteristicas: propios?.caracteristicas?.trim() || parrafoInmueble(acta),
    evidencia: propios?.evidencia?.trim() ? evidenciaDeTexto(propios.evidencia) : modernizarEvidencia(salida.evidencia_observada, acta.danos),
  };
}
