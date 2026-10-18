import PizZip from "pizzip";
import { XMLSerializer } from "@xmldom/xmldom";
import type { EvidenciaRecinto } from "../domain/tipos";
import { baseDeRpr, parrafoEvidenciaXml } from "./evidencia-xml";
import { fotoFinal, type FotoOrigen } from "../fotos/procesar";
import { CALIDAD_POR_DEFECTO, type Calidad } from "../fotos/calidad";
import { MARCA_CUADRO } from "./cuadro";
import { crearEl, hijos, NS_W, parse, ponerTextoParrafo, porTag, reemplazarEnParrafo, serializar, textoDe, type Doc } from "./docx-xml";
import { bloquesPorGrupo, ESTILO_PIE_FOTOS, ESTILO_TITULO_FOTOS, type FotoCelda } from "./fotos-xml";

/**
 * Mantiene el Word al día cuando cambia algo de lo que depende: el cuadro de pérdida y los totales del texto (al editar el
 * Excel) y las fotografías (al editar su recorte o elegir cuáles van). Todo lo demás del documento —incluidas las ediciones
 * manuales de texto— se deja intacto.
 */

const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const cargar = (buf: Buffer) => {
  const zip = new PizZip(buf);
  const doc: Doc = parse(zip.file("word/document.xml")!.asText());
  return { zip, doc, body: doc.getElementsByTagNameNS(NS_W, "body")[0] as unknown as Element };
};
const guardar = (zip: PizZip, doc: Doc) => {
  zip.file("word/document.xml", serializar(doc));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
};

const nombreDeDibujo = (el: Element): string[] => Array.from(el.getElementsByTagNameNS(NS_WP, "docPr")).map((d) => d.getAttribute("name") ?? "");
const esTablaDe = (t: Element, marca: string) => porTag(t, "tblCaption").some((c) => (c.getAttributeNS(NS_W, "val") ?? c.getAttribute("w:val")) === marca);

/** Reemplaza el cuadro de pérdida por uno nuevo (generado con los valores actuales del Excel). */
export function reemplazarCuadro(docx: Buffer, tablaXml: string): { buffer: Buffer; encontrado: boolean } {
  const { zip, doc, body } = cargar(docx);
  const vieja = porTag(body, "tbl").find((t) => esTablaDe(t, MARCA_CUADRO));
  if (!vieja) return { buffer: docx, encontrado: false };
  const nueva = crearEl(doc, tablaXml);
  vieja.parentNode!.replaceChild(nueva, vieja);
  return { buffer: guardar(zip, doc), encontrado: true };
}

/** Cambia los valores del texto (UF y pesos del informe) por los nuevos, sin importar cómo estén partidos entre tramos. */
export function actualizarTotales(docx: Buffer, pares: [string, string][]): { buffer: Buffer; reemplazos: number } {
  const unicos = pares.filter(([de, a], i) => de !== a && pares.findIndex((p) => p[0] === de) === i);
  if (unicos.length === 0) return { buffer: docx, reemplazos: 0 };
  const { zip, doc, body } = cargar(docx);
  const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let n = 0;
  const cuadro = new Set(porTag(body, "tbl").filter((t) => esTablaDe(t, MARCA_CUADRO)).flatMap((t) => porTag(t, "p")));
  for (const p of porTag(body, "p")) {
    if (cuadro.has(p)) continue; // el cuadro se rehace entero aparte
    // En dos fases (valor → marcador → valor nuevo) para que un valor nuevo no sea reemplazado otra vez por otro par.
    unicos.forEach(([de], i) => {
      // Los números no pueden formar parte de otro número más largo (46,73 dentro de 146,73).
      n += reemplazarEnParrafo(p, new RegExp(`(?<![\\d.,])${escapar(de)}(?![\\d])`), () => `\u0001${i}\u0001`);
    });
    unicos.forEach(([, a], i) => reemplazarEnParrafo(p, new RegExp(`\u0001${i}\u0001`), () => a));
  }
  return { buffer: n ? guardar(zip, doc) : docx, reemplazos: n };
}

export type FotoParaWord = FotoOrigen & { id: string; leyenda: string };

function agregarJpg(zip: PizZip, rels: { texto: string }, jpg: Buffer, n: number): string {
  const nombre = `cesar-f${Date.now().toString(36)}-${n}.jpg`;
  zip.file(`word/media/${nombre}`, jpg);
  const rid = `rIdF${Date.now().toString(36)}${n}`;
  rels.texto = rels.texto.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nombre}"/></Relationships>`);
  return rid;
}

/** Título o leyenda de grupo que puso este sistema (se reconocen por su estilo-marca) y que se rehacen junto con las tablas. */
const esMarcaDeFotos = (p: Element): boolean => {
  const v = p.getElementsByTagNameNS(NS_W, "pStyle")[0]?.getAttributeNS(NS_W, "val") ?? p.getElementsByTagNameNS(NS_W, "pStyle")[0]?.getAttribute("w:val");
  return v === ESTILO_TITULO_FOTOS || v === ESTILO_PIE_FOTOS;
};

/**
 * Rehace la sección de fotografías del informe con la selección y los recortes actuales: quita las tablas de fotos anteriores
 * (conserva la imagen de fachada que tuvieran) y pone las nuevas en cuadrículas de 2 × 3.
 */
export async function reemplazarFotos(docx: Buffer, fotos: FotoParaWord[], pies: Record<string, string> = {}, opc: { calidad?: Calidad; alOmitirFoto?: (f: FotoParaWord) => void } = {}): Promise<{ buffer: Buffer; encontrado: boolean }> {
  const { zip, doc, body } = cargar(docx);
  const ancla = hijos(body).find((e) => e.localName === "p" && /Las siguientes imágenes dan cuenta/.test(textoDe(e)));
  if (!ancla) return { buffer: docx, encontrado: false };

  // Tablas de fotos que siguen al párrafo ancla (con sus separadores vacíos).
  const viejas: Element[] = [];
  for (let s = ancla.nextSibling; s; s = s.nextSibling) {
    if (s.nodeType !== 1) continue;
    const el = s as Element;
    if (el.localName === "tbl" && nombreDeDibujo(el).some((n) => /^(foto|fachada)/.test(n))) viejas.push(el);
    else if (el.localName === "p" && esMarcaDeFotos(el)) viejas.push(el);
    else if (el.localName === "p" && textoDe(el).trim() === "" && !el.getElementsByTagNameNS(NS_W, "drawing").length) viejas.push(el);
    else break;
  }
  let ridFachada: string | null = null;
  for (const t of viejas) {
    const d = Array.from(t.getElementsByTagNameNS(NS_WP, "docPr")).find((x) => x.getAttribute("name") === "fachada");
    if (d) {
      const blip = (d.parentNode as Element).getElementsByTagNameNS(NS_A, "blip")[0];
      ridFachada = blip?.getAttributeNS(NS_R, "embed") ?? blip?.getAttribute("r:embed") ?? null;
    }
  }

  const rels = { texto: zip.file("word/_rels/document.xml.rels")!.asText() };
  const celdas: FotoCelda[] = [];
  let n = 0;
  for (const f of fotos) {
    const final = await fotoFinal(f, opc.calidad ?? CALIDAD_POR_DEFECTO);
    if (!final) {
      opc.alOmitirFoto?.(f);
      continue;
    }
    celdas.push({ rid: agregarJpg(zip, rels, final, n++), leyenda: f.edicion?.leyenda ?? "", id: f.id, grupo: f.recinto });
  }
  for (const t of viejas) t.parentNode!.removeChild(t);

  let ultimo: Node = ancla;
  for (const bloque of bloquesPorGrupo(celdas, pies, ridFachada ? { rid: ridFachada, leyenda: "" } : null)) {
    for (const xml of bloque) {
      const pieza = crearEl(doc, xml);
      ultimo.parentNode!.insertBefore(pieza, ultimo.nextSibling);
      ultimo = pieza;
    }
    const sep = crearEl(doc, `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`);
    ultimo.parentNode!.insertBefore(sep, ultimo.nextSibling);
    ultimo = sep;
  }

  // Imágenes que ya no se usan (fotos reemplazadas): se retiran del paquete para que no engorde.
  const xmlNuevo = serializar(doc);
  let relsTexto = rels.texto;
  for (const m of rels.texto.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="media\/(cesar-[^"]+)"[^>]*\/>|<Relationship\b[^>]*Target="media\/(cesar-[^"]+)"[^>]*Id="([^"]+)"[^>]*\/>/g)) {
    const id = m[1] ?? m[4];
    const archivo = m[2] ?? m[3];
    if (!xmlNuevo.includes(`"${id}"`)) {
      zip.remove(`word/media/${archivo}`);
      relsTexto = relsTexto.replace(m[0], "");
    }
  }
  zip.file("word/_rels/document.xml.rels", relsTexto);
  let ct = zip.file("[Content_Types].xml")!.asText();
  if (!/Extension="jpg"/.test(ct)) ct = ct.replace("<Default ", `<Default Extension="jpg" ContentType="image/jpeg"/><Default `);
  zip.file("[Content_Types].xml", ct);
  zip.file("word/document.xml", xmlNuevo);
  return { buffer: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }), encontrado: true };
}

/**
 * Pone en un informe ya generado los textos que el usuario corrigió en «Datos»: el párrafo de características del bien (el primero con texto tras su título)
 * y la lista de evidencia observada (entre su frase de introducción y «Las siguientes imágenes dan cuenta…»). El resto del documento no se toca.
 */
export function reemplazarTextosDatos(docx: Buffer, t: { caracteristicas?: string; evidencia?: EvidenciaRecinto[] }): { buffer: Buffer; caracteristicas: boolean; evidencia: boolean } {
  const { zip, doc, body } = cargar(docx);
  const ps = hijos(body);
  let car = false;
  let evi = false;
  if (t.caracteristicas?.trim()) {
    const i = ps.findIndex((e) => e.localName === "p" && /Caracter[ií]sticas del bien en riesgo/.test(textoDe(e)));
    const p = i >= 0 ? ps.slice(i + 1).find((e) => e.localName === "p" && textoDe(e).trim() !== "") : undefined;
    if (p) {
      ponerTextoParrafo(doc, p, t.caracteristicas.trim());
      car = true;
    }
  }
  if (t.evidencia) {
    const intro = ps.findIndex((e) => e.localName === "p" && /Durante la visita de inspecci[oó]n se observ/.test(textoDe(e)));
    const fin = ps.findIndex((e, k) => k > intro && e.localName === "p" && /Las siguientes im[aá]genes dan cuenta/.test(textoDe(e)));
    if (intro >= 0 && fin > intro) {
      const rprModelo = porTag(ps[intro], "rPr").pop();
      const base = baseDeRpr(rprModelo ? new XMLSerializer().serializeToString(rprModelo as never) : "");
      for (const e of ps.slice(intro + 1, fin)) if (textoDe(e).trim() !== "" || porTag(e, "numPr").length) e.parentNode!.removeChild(e);
      for (const ev of t.evidencia) ps[fin].parentNode!.insertBefore(crearEl(doc, parrafoEvidenciaXml(ev, base)), ps[fin]);
      evi = true;
    }
  }
  return { buffer: car || evi ? guardar(zip, doc) : docx, caracteristicas: car, evidencia: evi };
}
