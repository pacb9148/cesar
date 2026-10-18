import type { DatosCaso, EvidenciaRecinto, SalidaAgente } from "../domain/tipos";
import type { ActaInspeccion } from "../extraccion/acta";
import { modernizarEvidencia, parrafoInmueble, parrafoPlantilla } from "./parrafo-inmueble";

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

/**
 * Orden de las estancias tal como aparecen en la lista de «Evidencia observada» (la que editó el usuario o, si no, la de la inspección).
 * Es el orden de referencia de todo el informe: partidas del ajuste, hojas del Excel y fotos.
 */
export function ordenEstancias(datos: Pick<DatosCaso, "textos">, acta: Pick<ActaInspeccion, "danos">): string[] {
  const propia = datos.textos?.evidencia?.trim();
  const recintos = propia ? evidenciaDeTexto(propia).map((e) => e.recinto) : acta.danos.map((d) => d.recinto);
  return [...new Set(recintos.map((r) => r.trim()).filter(Boolean))];
}

export type TextosInforme = { caracteristicas: string; evidencia: EvidenciaRecinto[] };

/** Lo que va al informe: el texto que editó el usuario en «Datos» o, si no hay, el que sale de la inspección y del ajuste. */
export function textosDelInforme(datos: Pick<DatosCaso, "textos">, acta: ActaInspeccion, salida: Pick<SalidaAgente, "evidencia_observada"> & Partial<Pick<SalidaAgente, "caracteristicas">>): TextosInforme {
  const propios = datos.textos;
  return {
    // Redacción de la plantilla con las características del ajuste (editables allí) o, si no hay, las de la inspección.
    caracteristicas: propios?.caracteristicas?.trim() || (salida.caracteristicas ? parrafoPlantilla(Object.fromEntries(Object.entries(salida.caracteristicas).map(([k, d]) => [k === "superficie_m2" ? "superficie" : k === "antiguedad_anios" ? "antiguedad" : k === "sistema_estructural" ? "sistema" : k, d.valor]))) : parrafoInmueble(acta)),
    evidencia: propios?.evidencia?.trim() ? evidenciaDeTexto(propios.evidencia) : modernizarEvidencia(salida.evidencia_observada, acta.danos),
  };
}
