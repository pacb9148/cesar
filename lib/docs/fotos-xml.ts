import { FOTO_ALTO_CM, FOTO_ANCHO_CM, FOTOS_COLUMNAS, FOTOS_POR_TABLA, LEYENDA_FOTO_MAX } from "../domain/constantes";
import { pxDeCalidad } from "../fotos/calidad";
import { escXml, xmlImagen } from "./docx-xml";

/** Tamaño de cada foto en EMU (unidad de Word): exactamente FOTO_ANCHO_CM × FOTO_ALTO_CM (8,66 × 6,70 cm). */
export const FOTO_EMU = { cx: Math.round(FOTO_ANCHO_CM * 360000), cy: Math.round(FOTO_ALTO_CM * 360000) };
/** Píxeles de la imagen incrustada (≈300 ppp) con la misma proporción que la caja de la foto. */
export const FOTO_PX = pxDeCalidad("300");
/** Ancho de cada celda en twips: 8,66 cm, para que la imagen ocupe la celda sin encogerse ni salirse. */
const CELDA_TWIPS = Math.round((FOTO_ANCHO_CM / 2.54) * 1440);

/** `id` es el del archivo de la foto: queda en el nombre de la imagen del Word (`foto:<id>`) para poder reemplazarla al editarla. */
export type FotoCelda = { rid: string; leyenda: string; id?: string; /** Estancia a la que pertenece: da el título y el pie del grupo. */ grupo?: string };

export const leyendaCorta = (t: string, max = LEYENDA_FOTO_MAX): string => {
  const limpio = t.replace(/\s+/g, " ").trim();
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 1).trimEnd()}…`;
};

const fuente = (sz: number, extra = "") => `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${extra}<w:sz w:val="${sz}"/></w:rPr>`;

/** Márgenes internos a cero en los cuatro lados: las fotos se tocan entre sí sin franjas blancas. */
const SIN_MARGEN = `<w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar>`;

const celda = (f: FotoCelda | undefined, nombre: string, ancho: number, span = 1) => {
  const contenido = f
    ? `<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r>${xmlImagen(f.rid, FOTO_EMU.cx, FOTO_EMU.cy, nombre)}</w:r></w:p>` +
      // Leyenda opcional: solo si el usuario la escribió. Una línea (Times New Roman 10, cursiva, centrada), pegada a la imagen.
      (f.leyenda.trim() ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r>${fuente(20, "<w:i/><w:noProof/>")}<w:t xml:space="preserve">${escXml(leyendaCorta(f.leyenda))}</w:t></w:r></w:p>` : "")
    : `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}${SIN_MARGEN}</w:tcPr>${contenido}</w:tc>`;
};

/** Estilos-marca de los párrafos de título y pie: permiten reconocerlos y retirarlos al rehacer la sección de fotos. */
export const ESTILO_TITULO_FOTOS = "CesarFotoTitulo";
export const ESTILO_PIE_FOTOS = "CesarFotoPie";

/** Título de estancia FUERA de la tabla: Times New Roman 12, negrita cursiva, a la izquierda y pegado a la tabla que sigue. */
const tituloXml = (texto: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${ESTILO_TITULO_FOTOS}"/><w:keepNext/><w:spacing w:before="120" w:after="40"/></w:pPr><w:r>${fuente(24, "<w:b/><w:i/>")}<w:t xml:space="preserve">${escXml(texto)}</w:t></w:r></w:p>`;

/** Leyenda del grupo FUERA de la tabla, al final del grupo: Times New Roman 10, negrita, centrada. */
const pieXml = (texto: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${ESTILO_PIE_FOTOS}"/><w:spacing w:before="60" w:after="120"/><w:jc w:val="center"/></w:pPr><w:r>${fuente(20, "<w:b/>")}<w:t xml:space="preserve">${escXml(leyendaCorta(texto, 400))}</w:t></w:r></w:p>`;

const SIN_BORDES = `<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>`;

/**
 * Tablas de fotos: columnas × filas fijas (2 × 3), cada imagen de 8,66 × 6,70 cm con su leyenda de una línea y SOLO imágenes (el título y la
 * leyenda del grupo van en párrafos aparte). Si hay fachada va como fila de cabecera, centrada y del mismo tamaño. Con más de 6 fotos se generan varias tablas.
 */
export function tablasDeFotos(fotos: FotoCelda[], opciones: { fachada?: FotoCelda | null } = {}): string[] {
  const grupos: FotoCelda[][] = [];
  for (let i = 0; i < fotos.length; i += FOTOS_POR_TABLA) grupos.push(fotos.slice(i, i + FOTOS_POR_TABLA));
  if (grupos.length === 0 && opciones.fachada) grupos.push([]);
  const ancho = CELDA_TWIPS;
  return grupos.map((g, n) => {
    const filas: string[] = [];
    if (n === 0 && opciones.fachada) filas.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${celda(opciones.fachada, "fachada", ancho * FOTOS_COLUMNAS, FOTOS_COLUMNAS)}</w:tr>`);
    for (let i = 0; i < g.length; i += FOTOS_COLUMNAS) {
      const tcs = Array.from({ length: FOTOS_COLUMNAS }, (_, k) => celda(g[i + k], g[i + k]?.id ? `foto:${g[i + k].id}` : `foto-${n * FOTOS_POR_TABLA + i + k + 1}`, ancho));
      filas.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${tcs.join("")}</w:tr>`);
    }
    return (
      `<w:tbl><w:tblPr><w:tblW w:w="${ancho * FOTOS_COLUMNAS}" w:type="dxa"/><w:jc w:val="center"/>${SIN_BORDES}<w:tblLayout w:type="fixed"/>` +
      `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${Array.from({ length: FOTOS_COLUMNAS }, () => `<w:gridCol w:w="${ancho}"/>`).join("")}</w:tblGrid>${filas.join("")}</w:tbl>`
    );
  });
}

/** Piezas (párrafos y tablas) de un grupo de fotos: título fuera de la tabla, la(s) tabla(s) y la leyenda del grupo al final, también fuera. */
export function piezasDeGrupo(fotos: FotoCelda[], opciones: { titulo?: string; pie?: string } = {}): string[] {
  const tablas = tablasDeFotos(fotos);
  const out: string[] = [];
  tablas.forEach((t, n) => {
    if (opciones.titulo) out.push(tituloXml(n === 0 ? opciones.titulo : `${opciones.titulo} (continuación)`));
    out.push(t);
  });
  if (opciones.pie && tablas.length) out.push(pieXml(opciones.pie));
  return out;
}

/**
 * Todas las fotos del informe agrupadas por estancia: un bloque por grupo, en el orden en que aparece cada estancia (la fachada, si existe, va primero y sola,
 * centrada). Cada bloque es una lista de piezas XML: título, tabla(s) y leyenda del grupo.
 */
export function bloquesPorGrupo(celdas: FotoCelda[], pies: Record<string, string> = {}, fachada: FotoCelda | null = null): string[][] {
  const grupos = new Map<string, FotoCelda[]>();
  for (const c of celdas) grupos.set(c.grupo ?? "", [...(grupos.get(c.grupo ?? "") ?? []), c]);
  const out: string[][] = fachada ? [tablasDeFotos([], { fachada })] : [];
  for (const [g, lista] of grupos) out.push(piezasDeGrupo(lista, { titulo: g || undefined, pie: pies[g]?.trim() || undefined }));
  return out;
}

export const tablasPorGrupo = (celdas: FotoCelda[], pies: Record<string, string> = {}, fachada: FotoCelda | null = null): string[] => bloquesPorGrupo(celdas, pies, fachada).flat();
