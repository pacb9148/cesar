import { FOTO_ALTO_CM, FOTO_ANCHO_CM, FOTOS_COLUMNAS, FOTOS_POR_TABLA, LEYENDA_FOTO_MAX } from "../domain/constantes";
import { escXml, xmlImagen } from "./docx-xml";

/** Tamaño de cada foto en EMU (unidad de Word): exactamente FOTO_ANCHO_CM × FOTO_ALTO_CM (8,66 × 6,70 cm). */
export const FOTO_EMU = { cx: Math.round(FOTO_ANCHO_CM * 360000), cy: Math.round(FOTO_ALTO_CM * 360000) };
/** Píxeles de la imagen incrustada (≈300 ppp) con la misma proporción que la caja de la foto. */
export const FOTO_PX = { ancho: 1024, alto: Math.round((1024 * FOTO_ALTO_CM) / FOTO_ANCHO_CM) };
/** Ancho de cada celda en twips: 8,66 cm, para que la imagen ocupe la celda sin encogerse ni salirse. */
const CELDA_TWIPS = Math.round((FOTO_ANCHO_CM / 2.54) * 1440);

/** `id` es el del archivo de la foto: queda en el nombre de la imagen del Word (`foto:<id>`) para poder reemplazarla al editarla. */
export type FotoCelda = { rid: string; leyenda: string; id?: string; /** Estancia a la que pertenece: da el título y el pie del grupo. */ grupo?: string };

export const leyendaCorta = (t: string, max = LEYENDA_FOTO_MAX): string => {
  const limpio = t.replace(/\s+/g, " ").trim();
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 1).trimEnd()}…`;
};

const fuente = (sz: number, extra = "") => `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${extra}<w:sz w:val="${sz}"/></w:rPr>`;

const celda = (f: FotoCelda | undefined, nombre: string, ancho: number, span = 1) => {
  const contenido = f
    ? `<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r>${xmlImagen(f.rid, FOTO_EMU.cx, FOTO_EMU.cy, nombre)}</w:r></w:p>` +
      // Leyenda opcional: solo si el usuario la escribió. Una línea (Times New Roman 10, cursiva, centrada), pegada a la imagen.
      (f.leyenda.trim() ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r>${fuente(20, "<w:i/><w:noProof/>")}<w:t xml:space="preserve">${escXml(leyendaCorta(f.leyenda))}</w:t></w:r></w:p>` : "")
    : `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}</w:tcPr>${contenido}</w:tc>`;
};

/**
 * Tabla de fotos: columnas × filas fijas (2 × 3), cada imagen de 8,66 × 6,70 cm con su leyenda de una línea; título de la estancia sin espacio sobre la tabla.
 * Si hay fachada va como fila de cabecera, centrada y del mismo tamaño. Con más de 6 fotos se generan varias tablas.
 */
export function tablasDeFotos(fotos: FotoCelda[], opciones: { titulo?: string; fachada?: FotoCelda | null; pie?: string } = {}): string[] {
  const grupos: FotoCelda[][] = [];
  for (let i = 0; i < fotos.length; i += FOTOS_POR_TABLA) grupos.push(fotos.slice(i, i + FOTOS_POR_TABLA));
  if (grupos.length === 0 && opciones.fachada) grupos.push([]);
  const ancho = CELDA_TWIPS;
  return grupos.map((g, n) => {
    const filas: string[] = [];
    if (opciones.titulo)
      filas.push(
        `<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${ancho * FOTOS_COLUMNAS}" w:type="dxa"/><w:gridSpan w:val="${FOTOS_COLUMNAS}"/></w:tcPr><w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r>${fuente(24, "<w:b/><w:i/>")}<w:t xml:space="preserve">${escXml(n === 0 ? opciones.titulo : `${opciones.titulo} (continuación)`)}</w:t></w:r></w:p></w:tc></w:tr>`,
      );
    if (n === 0 && opciones.fachada) filas.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${celda(opciones.fachada, "fachada", ancho * FOTOS_COLUMNAS, FOTOS_COLUMNAS)}</w:tr>`);
    for (let i = 0; i < g.length; i += FOTOS_COLUMNAS) {
      const tcs = Array.from({ length: FOTOS_COLUMNAS }, (_, k) => celda(g[i + k], g[i + k]?.id ? `foto:${g[i + k].id}` : `foto-${n * FOTOS_POR_TABLA + i + k + 1}`, ancho));
      filas.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${tcs.join("")}</w:tr>`);
    }
    // Leyenda del grupo (opcional): una fila al pie de la última tabla de la estancia, Times New Roman 10 cursiva centrada.
    if (opciones.pie && n === grupos.length - 1)
      filas.push(
        `<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${ancho * FOTOS_COLUMNAS}" w:type="dxa"/><w:gridSpan w:val="${FOTOS_COLUMNAS}"/></w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r>${fuente(20, "<w:i/>")}<w:t xml:space="preserve">${escXml(leyendaCorta(opciones.pie, 400))}</w:t></w:r></w:p></w:tc></w:tr>`,
      );
    return (
      `<w:tbl><w:tblPr><w:tblW w:w="${ancho * FOTOS_COLUMNAS}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>` +
      `<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${Array.from({ length: FOTOS_COLUMNAS }, () => `<w:gridCol w:w="${ancho}"/>`).join("")}</w:tblGrid>${filas.join("")}</w:tbl>`
    );
  });
}

/**
 * Todas las fotos del informe agrupadas por estancia, cada grupo con su nombre arriba y, si el usuario la escribió, su leyenda al pie.
 * La fachada, si existe, va primero y sola, centrada. Los grupos salen en el orden en que aparece cada estancia.
 */
export function tablasPorGrupo(celdas: FotoCelda[], pies: Record<string, string> = {}, fachada: FotoCelda | null = null): string[] {
  const grupos = new Map<string, FotoCelda[]>();
  for (const c of celdas) grupos.set(c.grupo ?? "", [...(grupos.get(c.grupo ?? "") ?? []), c]);
  const out: string[] = fachada ? tablasDeFotos([], { fachada }) : [];
  for (const [g, lista] of grupos) out.push(...tablasDeFotos(lista, { titulo: g || undefined, pie: pies[g]?.trim() || undefined }));
  return out;
}
