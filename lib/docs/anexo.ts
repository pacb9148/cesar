import PizZip from "pizzip";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { escXml, hijos, NS_W, parse, serializar, crearEl, type Doc } from "./docx-xml";
import { fotoFinal } from "../fotos/procesar";
import type { Calidad } from "../fotos/calidad";
import { ESTILO_PIE_FOTOS, ESTILO_TITULO_FOTOS, bloquesPorGrupo, type FotoCelda } from "./fotos-xml";
import type { FotoInforme } from "./word";

/** Márgenes del anexo compacto en twips: 1,5 cm arriba/abajo, 1,84 cm izquierda/derecha. */
export const MARGENES_COMPACTOS = { top: 850, bottom: 850, left: 1043, right: 1043 } as const;

/**
 * Anexo de fotografías: portada + las fotos del informe con su misma disposición (2 × 3 por estancia). Se construye sobre la misma plantilla del informe
 * para heredar cabecera con logo, pies y estilos, y se vacía el cuerpo.
 */
export async function generarAnexo(o: { siniestro: string; asegurado: string; liquidacion: string; anio: string; fotos: FotoInforme[]; fachada?: Buffer; pies?: Record<string, string>; calidad?: Calidad; compacto?: boolean; alOmitirFoto?: (f: FotoInforme) => void }): Promise<Buffer> {
  const zip = new PizZip(readFileSync(join(process.cwd(), "plantillas", "informe.docx")));
  const doc: Doc = parse(zip.file("word/document.xml")!.asText());
  const body = doc.getElementsByTagNameNS(NS_W, "body")[0] as unknown as Element;
  const sect = hijos(body).filter((e) => e.localName === "sectPr").pop();
  for (const h of hijos(body)) if (h !== sect) body.removeChild(h);

  // Cabeceras y pies con los datos del caso; la imagen de la plantilla de origen no se usa en el cuerpo.
  const partes = Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d\.xml$/.test(n));
  for (const n of partes) {
    let x = zip.file(n)!.asText();
    x = x.replace(/\{\{liquidacion\}\}/g, o.liquidacion).replace(/\{\{anio\}\}/g, o.anio);
    zip.file(n, x);
  }

  let rels = zip.file("word/_rels/document.xml.rels")!.asText();
  let n = 0;
  const add = (j: Buffer) => {
    const nombre = `anexo-${++n}.jpg`;
    zip.file(`word/media/${nombre}`, j);
    const rid = `rIdAnexo${n}`;
    rels = rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nombre}"/></Relationships>`);
    return rid;
  };
  const fuente = (sz: number, extra = "") => `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${extra}<w:sz w:val="${sz}"/></w:rPr>`;
  const par = (texto: string, sz: number, extra = "", jc = "center", antes = 0) =>
    `<w:p><w:pPr><w:spacing w:before="${antes}" w:after="120"/><w:jc w:val="${jc}"/></w:pPr><w:r>${fuente(sz, extra)}<w:t xml:space="preserve">${escXml(texto)}</w:t></w:r></w:p>`;

  const add1 = (xml: string) => body.insertBefore(crearEl(doc, xml), sect ?? null);
  if (o.compacto) {
    // Anexo compacto: sin portada ni saltos entre estancias, márgenes 1,5 cm arriba/abajo y 1,84 cm a los lados (A4: 17,32 cm útiles = 2 fotos de 8,66 cm).
    const mar = sect?.getElementsByTagNameNS(NS_W, "pgMar")[0];
    if (mar) for (const [k, v] of Object.entries(MARGENES_COMPACTOS)) mar.setAttributeNS(NS_W, "w:" + k, String(v));
  } else {
    add1(par("ANEXO", 56, "<w:b/>", "center", 3600));
    add1(par("FOTOGRAFÍAS", 56, "<w:b/>", "center"));
    add1(par(`Siniestro     ${o.siniestro}`, 28, "", "left", 2400));
    add1(par(`Asegurado ${o.asegurado}`, 28, "", "left"));
    add1(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
  }

  // Las mismas fotos del informe, en el mismo orden y disposición: fachada primero y sola, y un bloque por estancia (título, tabla(s) y leyenda del
  // grupo, todo fuera de las tablas). El orden de las estancias y de las fotos es el de la lista recibida (la selección del informe).
  const celdas: FotoCelda[] = [];
  for (const f of o.fotos) {
    const final = await fotoFinal(f, o.calidad ?? "300");
    if (!final) {
      o.alOmitirFoto?.(f);
      continue;
    }
    celdas.push({ rid: add(final), leyenda: f.edicion?.leyenda ?? "", id: f.id, grupo: f.recinto });
  }
  const fachada: FotoCelda | null = o.fachada ? { rid: add(o.fachada), leyenda: "" } : null;
  const piezas = bloquesPorGrupo(celdas, o.pies ?? {}, fachada).flat();
  // Cada tabla de 6 fotos casi llena la página: el salto va antes de cada título (o de una tabla que sigue a otra) y en un párrafo de 1 pt para no desbordar.
  const salto = o.compacto ? "" : `<w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:br w:type="page"/></w:r>`;
  const separador = `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>${salto}</w:p>`;
  piezas.forEach((x, i) => {
    const esTabla = x.startsWith("<w:tbl>");
    const previaTabla = i > 0 && (piezas[i - 1].startsWith("<w:tbl>") || piezas[i - 1].includes(ESTILO_PIE_FOTOS));
    const esTitulo = x.includes(ESTILO_TITULO_FOTOS);
    if (i > 0 && (esTitulo || (esTabla && previaTabla))) add1(separador);
    add1(x);
  });
  zip.file("word/document.xml", serializar(doc));
  zip.file("word/_rels/document.xml.rels", rels);
  let ct = zip.file("[Content_Types].xml")!.asText();
  if (!/Extension="jpg"/.test(ct)) ct = ct.replace("<Default ", `<Default Extension="jpg" ContentType="image/jpeg"/><Default `);
  zip.file("[Content_Types].xml", ct);
  let rels2 = zip.file("word/_rels/document.xml.rels")!.asText();
  for (const img of ["image5.emf", "image3.jpeg", "image4.jpeg", "image6.png"]) {
    rels2 = rels2.replace(new RegExp(`<Relationship [^>]*Target="media/${img.replace(".", "[.]")}"[^>]*/>`), "");
    zip.remove(`word/media/${img}`);
  }
  zip.file("word/_rels/document.xml.rels", rels2);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
