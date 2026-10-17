import { escXml } from "./docx-xml";
import type { EvidenciaRecinto } from "../domain/tipos";

/** Propiedades de carácter del texto de la plantilla sin negrita, cursiva ni subrayado (sirven de base para cada tramo de la viñeta). */
export const baseDeRpr = (rprXml: string): string => rprXml.replace(/^<w:rPr[^>]*>|<[/]w:rPr>$/g, "").replace(/<w:(b|i|u)[ /][^>]*>|<w:(b|i|u)>/g, "");

/** Una viñeta de la evidencia observada: tilde (numeración 1 de la plantilla), el recinto en cursiva subrayada y el texto. Sin recinto, solo el texto. */
export function parrafoEvidenciaXml(ev: Pick<EvidenciaRecinto, "recinto" | "vineta" | "atribuible">, base: string): string {
  const rpr = (extra: string) => `<w:rPr>${base}${extra}</w:rPr>`;
  const sufijo = ev.atribuible ? "" : " No atribuible al siniestro.";
  return (
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="0" w:after="0"/><w:ind w:left="720" w:hanging="360"/><w:jc w:val="both"/></w:pPr>` +
    (ev.recinto ? `<w:r>${rpr('<w:i/><w:u w:val="single"/>')}<w:t xml:space="preserve">${escXml(ev.recinto)}:</w:t></w:r>` : "") +
    `<w:r>${rpr("")}<w:t xml:space="preserve">${ev.recinto ? " " : ""}${escXml(ev.vineta)}${sufijo}</w:t></w:r></w:p>`
  );
}
