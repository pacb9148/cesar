import PizZip from "pizzip";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { escXml, hijos, NS_W, parse, serializar, xmlImagen, crearEl, type Doc } from "./docx-xml";
import type { FotoInforme } from "./word";

const EMU_IN = 914400;

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
    const j = await sharp(buf).rotate().resize(900, 675, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
    const nombre = `anexo-${++n}.jpg`;
    zip.file(`word/media/${nombre}`, j);
    const rid = `rIdAnexo${n}`;
    rels = rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nombre}"/></Relationships>`);
    return { rid, cx: Math.round(3.45 * EMU_IN), cy: Math.round(3.45 * EMU_IN * 0.75) };
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

  const recintos = [...new Set(o.fotos.map((f) => f.recinto))];
  for (const [ri, rc] of recintos.entries()) {
    const fotos = o.fotos.filter((f) => f.recinto === rc);
    for (let i = 0; i < fotos.length; i += 4) {
      const grupo = fotos.slice(i, i + 4);
      const medias: { rid: string; cx: number; cy: number }[] = [];
      for (const f of grupo) medias.push(await add(f.buffer));
      const filas: string[] = [];
      for (let k = 0; k < medias.length; k += 2) {
        const tcs = [0, 1].map((c) => {
          const m = medias[k + c];
          return `<w:tc><w:tcPr><w:tcW w:w="5085" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr>${m ? `<w:r>${xmlImagen(m.rid, m.cx, m.cy, `anexo-${k + c}`)}</w:r>` : ""}</w:p></w:tc>`;
        });
        filas.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${tcs.join("")}</w:tr>`);
      }
      add1(par(i === 0 ? rc : `${rc} (continuación)`, 24, "<w:b/><w:i/>", "left"));
      add1(`<w:tbl><w:tblPr><w:tblW w:w="10170" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="5085"/><w:gridCol w:w="5085"/></w:tblGrid>${filas.join("")}</w:tbl>`);
      const ultimo = ri === recintos.length - 1 && i + 4 >= fotos.length;
      if (!ultimo) add1(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
    }
  }
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
