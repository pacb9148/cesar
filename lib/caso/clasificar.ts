export type TipoArchivo =
  | "acta"
  | "provision"
  | "presupuesto_xlsx"
  | "presupuesto_pdf"
  | "mandato"
  | "informe_tecnico"
  | "correspondencia"
  | "foto"
  | "otro";

export const ETIQUETA_TIPO: Record<TipoArchivo | "salida", string> = {
  acta: "Acta de inspección",
  provision: "Provisión de pérdida",
  presupuesto_xlsx: "Presupuesto (Excel)",
  presupuesto_pdf: "Presupuesto (PDF)",
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
  if (/mandato/.test(n)) return { tipo: "mandato", recinto: null };
  if (partes.includes("correspondencia") || /solicitud de antecedentes/.test(n)) return { tipo: "correspondencia", recinto: null };
  if (/informe.?tecnico/.test(n) && n.endsWith(".docx")) return { tipo: "informe_tecnico", recinto: null };
  if (n.endsWith(".xlsx") && /presupuesto|cotiz/.test(n)) return { tipo: "presupuesto_xlsx", recinto: null };
  if (n.endsWith(".pdf") && (partes.includes("documentos") || /presupuesto|cotiz/.test(n))) return { tipo: "presupuesto_pdf", recinto: null };
  return { tipo: "otro", recinto: null };
}
