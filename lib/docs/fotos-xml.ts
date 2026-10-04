import { FOTO_ALTO_CM, FOTO_ANCHO_CM, FOTOS_COLUMNAS, FOTOS_POR_TABLA, LEYENDA_FOTO_MAX } from "../domain/constantes";
import { escXml, xmlImagen } from "./docx-xml";

/** Tamaño de cada foto en EMU (unidad de Word): 7,8 × 6,5 cm exactos. */
export const FOTO_EMU = { cx: Math.round(FOTO_ANCHO_CM * 360000), cy: Math.round(FOTO_ALTO_CM * 360000) };
/** Píxeles de la imagen incrustada (≈300 ppp) con la misma proporción que la caja de 7,8 × 6,5 cm. */
export const FOTO_PX = { ancho: 936, alto: 780 };

export type FotoCelda = { rid: string; leyenda: string };

export const leyendaCorta = (t: string): string => {
  const limpio = t.replace(/\s+/g, " ").trim();
  return limpio.length <= LEYENDA_FOTO_MAX ? limpio : `${limpio.slice(0, LEYENDA_FOTO_MAX - 1).trimEnd()}…`;
};

const fuente = (sz: number, extra = "") => `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${extra}<w:sz w:val="${sz}"/></w:rPr>`;

const celda = (f: FotoCelda | undefined, nombre: string, ancho: number, span = 1) => {
  const contenido = f
    ? `<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r>${xmlImagen(f.rid, FOTO_EMU.cx, FOTO_EMU.cy, nombre)}</w:r></w:p>` +
      // Leyenda de una sola línea: tamaño pequeño y sin salto.
      `<w:p><w:pPr><w:spacing w:before="0" w:after="40"/><w:jc w:val="center"/></w:pPr><w:r>${fuente(16, "<w:i/><w:noProof/>")}<w:t xml:space="preserve">${escXml(leyendaCorta(f.leyenda))}</w:t></w:r></w:p>`
    : `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}</w:tcPr>${contenido}</w:tc>`;
};

/**
 * Tabla de fotos: columnas × filas fijas (2 × 3), cada imagen de 7,8 × 6,5 cm con su leyenda de una línea.
 * Si hay fachada va como fila de cabecera, centrada y del mismo tamaño. Con más de 6 fotos se generan varias tablas.
 */
export function tablasDeFotos(fotos: FotoCelda[], opciones: { titulo?: string; fachada?: FotoCelda | null } = {}): string[] {
  const grupos: FotoCelda[][] = [];
  for (let i = 0; i < fotos.length; i += FOTOS_POR_TABLA) grupos.push(fotos.slice(i, i + FOTOS_POR_TABLA));
  if (grupos.length === 0 && opciones.fachada) grupos.push([]);
  const ancho = 5085;
  return grupos.map((g, n) => {
    const filas: string[] = [];
    if (opciones.titulo)
      filas.push(
        `<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${ancho * FOTOS_COLUMNAS}" w:type="dxa"/><w:gridSpan w:val="${FOTOS_COLUMNAS}"/></w:tcPr><w:p><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="60"/></w:pPr><w:r>${fuente(24, "<w:b/><w:i/>")}<w:t xml:space="preserve">${escXml(n === 0 ? opciones.titulo : `${opciones.titulo} (continuación)`)}</w:t></w:r></w:p></w:tc></w:tr>`,
      );
    if (n === 0 && opciones.fachada) filas.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${celda(opciones.fachada, "fachada", ancho * FOTOS_COLUMNAS, FOTOS_COLUMNAS)}</w:tr>`);
    for (let i = 0; i < g.length; i += FOTOS_COLUMNAS) {
      const tcs = Array.from({ length: FOTOS_COLUMNAS }, (_, k) => celda(g[i + k], `foto-${n * FOTOS_POR_TABLA + i + k + 1}`, ancho));
      filas.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${tcs.join("")}</w:tr>`);
    }
    return (
      `<w:tbl><w:tblPr><w:tblW w:w="${ancho * FOTOS_COLUMNAS}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>` +
      `<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${Array.from({ length: FOTOS_COLUMNAS }, () => `<w:gridCol w:w="${ancho}"/>`).join("")}</w:tblGrid>${filas.join("")}</w:tbl>`
    );
  });
}
