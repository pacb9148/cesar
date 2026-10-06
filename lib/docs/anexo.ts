import PizZip from "pizzip";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { escXml, hijos, NS_W, parse, serializar, crearEl, type Doc } from "./docx-xml";
import { aplicarEdicion } from "../fotos/aplicar";
import { esEdicionNula } from "../fotos/recorte";
import { FOTO_PX, tablasDeFotos, type FotoCelda } from "./fotos-xml";
import type { FotoInforme } from "./word";

/**
 * Anexo de fotografías: portada + 2×2 por recinto. Se construye sobre la misma plantilla del informe
 * para heredar cabecera con logo, pies y estilos, y se vacía el cuerpo.
 */
export async function generarAnexo(o: { siniestro: string; asegurado: string; liquidacion: string; anio: string; fotos: FotoInforme[] }): Promise<Buffer> {
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
  const add = async (buf: Buffer) => {
    const j = await sharp(buf).rotate().resize(FOTO_PX.ancho, FOTO_PX.alto, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 82 }).toBuffer();
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
  add1(par("ANEXO", 56, "<w:b/>", "center", 3600));
  add1(par("FOTOGRAFÍAS", 56, "<w:b/>", "center"));
  add1(par(`Siniestro     ${o.siniestro}`, 28, "", "left", 2400));
  add1(par(`Asegurado ${o.asegurado}`, 28, "", "left"));
  add1(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);

  // Todas las fotos del caso, por recinto, en cuadrículas de 2 × 3 con el mismo tamaño y leyenda que el informe.
  const recintos = [...new Set(o.fotos.map((f) => f.recinto))];
  const tablas: string[] = [];
  for (const rc of recintos) {
    const celdas: FotoCelda[] = [];
    for (const f of o.fotos.filter((x) => x.recinto === rc)) celdas.push({ rid: await add(f.edicion && !esEdicionNula(f.edicion) ? await aplicarEdicion(f.buffer, f.edicion) : f.buffer), leyenda: f.edicion?.leyenda || f.leyenda || rc, id: f.id });
    tablas.push(...tablasDeFotos(celdas, { titulo: rc }));
  }
  tablas.forEach((t, i) => {
    add1(t);
    if (i < tablas.length - 1) add1(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
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
