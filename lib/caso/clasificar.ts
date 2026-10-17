export type TipoArchivo =
  | "acta"
  | "provision"
  | "borrador"
  | "presupuesto_xlsx"
  | "presupuesto_pdf"
  | "presupuesto_otro"
  | "mandato"
  | "informe_tecnico"
  | "correspondencia"
  | "foto"
  | "otro";

export const ETIQUETA_TIPO: Record<TipoArchivo | "salida", string> = {
  acta: "Acta de inspección",
  provision: "Provisión de pérdida",
  borrador: "Borrador del informe",
  presupuesto_xlsx: "Presupuesto (Excel)",
  presupuesto_pdf: "Presupuesto (PDF)",
  presupuesto_otro: "Presupuesto (Word, imagen u otro)",
  mandato: "Mandato",
  informe_tecnico: "Informe técnico",
  correspondencia: "Correspondencia",
  foto: "Fotografía",
  otro: "Otro",
  salida: "Documento generado",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type Clasificacion = { tipo: TipoArchivo; recinto: string | null };

/**
 * Clasifica por nombre y por la carpeta de origen (FOTOGRAFÍAS/<Recinto>/…, DOCUMENTOS/, TEXTO/, CORRESPONDENCIA/).
 * Si el navegador no entrega la ruta relativa, el nombre solo alcanza para todos los documentos de los casos de referencia.
 */
export function clasificarArchivo(nombre: string, rutaRelativa: string | null, mime: string): Clasificacion {
  const ruta = norm(rutaRelativa ?? nombre).replace(/\\/g, "/");
  const n = norm(nombre);
  const partes = ruta.split("/");
  const esImagen = /^image\/(jpe?g|png|webp)$/.test(mime) || /\.(jpe?g|png|webp)$/.test(n);
  if (esImagen) {
    const original = (rutaRelativa ?? "").replace(/\\/g, "/").split("/");
    const carpeta = original.length >= 2 ? original[original.length - 2] : null;
    const esCarpetaFotos = !carpeta || /^f[o]{1,2}tograf/i.test(norm(carpeta));
    return { tipo: "foto", recinto: esCarpetaFotos ? null : carpeta };
  }
  if (/insp/.test(n) && n.endsWith(".pdf")) return { tipo: "acta", recinto: null };
  if (/provision/.test(n) && n.endsWith(".pdf")) return { tipo: "provision", recinto: null };
  // El borrador del informe (Word) trae los datos de portada: póliza, vigencia, fechas, partes y denuncia.
  if (/borrador/.test(n) && /\.docx?$/.test(n)) return { tipo: "borrador", recinto: null };
  if (/mandato/.test(n)) return { tipo: "mandato", recinto: null };
  if (partes.includes("correspondencia") || /solicitud de antecedentes/.test(n)) return { tipo: "correspondencia", recinto: null };
  if (/informe.?tecnico/.test(n) && n.endsWith(".docx")) return { tipo: "informe_tecnico", recinto: null };
  if (n.endsWith(".xlsx") && /presupuesto|cotiz/.test(n)) return { tipo: "presupuesto_xlsx", recinto: null };
  if (n.endsWith(".pdf") && (partes.includes("documentos") || /presupuesto|cotiz/.test(n))) return { tipo: "presupuesto_pdf", recinto: null };
  return { tipo: "otro", recinto: null };
}

/** Los tres lugares donde el usuario sube documentos: la inspección, el presupuesto y las fotos. */
export type Ranura = "inspeccion" | "presupuesto" | "fotos";
export const esRanura = (x: unknown): x is Ranura => x === "inspeccion" || x === "presupuesto" || x === "fotos";

/** Formatos que se aceptan en la inspección y el presupuesto: documentos, hojas de cálculo, PDF, texto e imágenes (se leen con visión si hace falta). */
export const FORMATOS_DOCUMENTO = /\.(pdf|docx?|xlsx?|csv|txt|jpe?g|png|webp|gif|bmp|tiff?)$/i;
export const FORMATOS_IMAGEN = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;

/**
 * Clasificación cuando el usuario eligió dónde subir: la ranura manda sobre el nombre. Inspección → siempre «acta» (en cualquier formato);
 * presupuesto → por formato (Excel, PDF u otro); fotos → solo imágenes, con la carpeta como estancia.
 * Devuelve null si el archivo no corresponde a la ranura (p. ej. un Word en la ranura de fotos).
 */
export function clasificarEnRanura(ranura: Ranura, nombre: string, rutaRelativa: string | null, mime: string): Clasificacion | null {
  const n = norm(nombre);
  if (ranura === "fotos") return FORMATOS_IMAGEN.test(n) || /^image\//.test(mime) ? clasificarArchivo(nombre, rutaRelativa, mime) : null;
  if (!FORMATOS_DOCUMENTO.test(n)) return null;
  if (ranura === "inspeccion") return { tipo: "acta", recinto: null };
  if (/\.xlsx?$/.test(n) || /\.csv$/.test(n)) return { tipo: "presupuesto_xlsx", recinto: null };
  if (n.endsWith(".pdf")) return { tipo: "presupuesto_pdf", recinto: null };
  return { tipo: "presupuesto_otro", recinto: null };
}
