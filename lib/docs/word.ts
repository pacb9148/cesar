import { aplicarEdicion } from "../fotos/aplicar";
import { esEdicionNula } from "../fotos/recorte";
import type { EdicionFoto } from "../fotos/recorte";
import { FOTO_PX, FOTO_EMU, tablasPorGrupo, type FotoCelda } from "./fotos-xml";
import PizZip from "pizzip";
import sharp from "sharp";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { MARCADOR_FALTA_DATO } from "../domain/constantes";
import type { Dato, DatosCaso, EvidenciaRecinto, SalidaAgente } from "../domain/tipos";
import {
  crearEl,
  escXml,
  hijos,
  NS_W,
  parse,
  porTag,
  reemplazarEnParrafo,
  reemplazarGlobal,
  serializar,
  textoDe,
  xmlImagen,
  type Doc,
  type Reemplazo,
} from "./docx-xml";

export type FotoInforme = { id?: string; recinto: string; buffer: Buffer; leyenda?: string; edicion?: EdicionFoto | null };

export type Meteo = {
  estacion: string | null;
  precipitacionMm: number | null;
  rafagaKmh: number | null;
  imagenPng: Buffer | null;
};

export type EntradaInforme = {
  caso: DatosCaso;
  valorUF: number;
  caracteristicas: SalidaAgente["caracteristicas"];
  evidencia: EvidenciaRecinto[];
  ajusteTexto: string;
  totales: { reclamacionPesos: number; reclamacionUF: number; ajusteUF: number; indemnizacionUF: number };
  meteo: Meteo | null;
  /** Cuadro de pérdida como tabla de Word (editable y actualizable al editar el Excel). */
  cuadroTabla: string[];
  fotos: FotoInforme[];
  /** Leyenda al pie de cada grupo de fotos (por estancia), opcional. */
  piesGrupos?: Record<string, string>;
  fachada: Buffer[];
  siniestrosAnteriores: boolean;
};

const PLANTILLA = join(process.cwd(), "plantillas", "informe.docx");
const EMU_IN = 914400;

const nf = (n: number, dec = 2) => n.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const pesos = (n: number) => Math.round(n).toLocaleString("es-CL");
const dmy = (iso: string) => iso.split("-").reverse().join("/");

const FALTA: Reemplazo = { texto: MARCADOR_FALTA_DATO, negrita: true };
const datoOFalta = (d: Dato | undefined, sufijo = ""): Reemplazo =>
  !d || d.estado === "faltante" || d.valor == null || d.valor === "" ? FALTA : `${d.valor}${sufijo}`;

type Media = { rid: string; cx: number; cy: number };

class Paquete {
  private n = 0;
  private rels: string;
  constructor(public zip: PizZip) {
    this.rels = zip.file("word/_rels/document.xml.rels")!.asText();
  }
  async imagen(buf: Buffer, anchoIn: number, opts: { cover43?: boolean; foto?: boolean; maxPx?: number } = {}): Promise<Media> {
    let img = sharp(buf).rotate();
    // Fotos del informe: recorte a 8,66 × 6,70 cm centrado en la zona más llamativa de la imagen (el área con el daño).
    if (opts.foto) img = img.resize(FOTO_PX.ancho, FOTO_PX.alto, { fit: "cover", position: sharp.strategy.attention });
    else if (opts.cover43) img = img.resize(900, 675, { fit: "cover" });
    else img = img.resize({ width: opts.maxPx ?? 1600, withoutEnlargement: true });
    const esPng = !opts.cover43 && !opts.foto;
    const salida = esPng ? await img.png().toBuffer() : await img.jpeg({ quality: 82 }).toBuffer();
    const meta = await sharp(salida).metadata();
    const ext = esPng ? "png" : "jpg";
    const nombre = `cesar-${++this.n}.${ext}`;
    this.zip.file(`word/media/${nombre}`, salida);
    const rid = `rIdCesar${this.n}`;
    this.rels = this.rels.replace(
      "</Relationships>",
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nombre}"/></Relationships>`,
    );
    if (opts.foto) return { rid, ...FOTO_EMU };
    const cx = Math.round(anchoIn * EMU_IN);
    const cy = Math.round((cx * (meta.height ?? 1)) / (meta.width ?? 1));
    return { rid, cx, cy };
  }
  cerrar() {
    this.zip.file("word/_rels/document.xml.rels", this.rels);
    let ct = this.zip.file("[Content_Types].xml")!.asText();
    for (const [ext, tipo] of [["jpg", "image/jpeg"], ["png", "image/png"]] as const) {
      if (!new RegExp(`Extension="${ext}"`).test(ct))
        ct = ct.replace("<Default ", `<Default Extension="${ext}" ContentType="${tipo}"/><Default `);
    }
    this.zip.file("[Content_Types].xml", ct);
  }
}

const hijosCuerpo = (doc: Doc) => hijos(doc.getElementsByTagNameNS(NS_W, "body")[0]);
const buscarP = (doc: Doc, re: RegExp) =>
  hijosCuerpo(doc).find((e) => e.localName === "p" && re.test(textoDe(e)));

/** Reemplaza todo lo que sigue a las primeras `conservar` runs por líneas separadas con saltos de línea. */
function reescribirCuerpo(p: Element, conservar: number, lineas: string[]) {
  const doc = p.ownerDocument;
  const runs = hijos(p).filter((c) => c.localName === "r");
  const modelo = runs[conservar] ?? runs[runs.length - 1];
  const rpr = modelo ? hijos(modelo).find((c) => c.localName === "rPr") : undefined;
  runs.slice(conservar).forEach((r) => p.removeChild(r));
  lineas.forEach((l, i) => {
    const r = doc.createElementNS(NS_W, "w:r");
    if (rpr) r.appendChild(rpr.cloneNode(true));
    if (i > 0) r.appendChild(doc.createElementNS(NS_W, "w:br"));
    if (i > 0) r.appendChild(doc.createElementNS(NS_W, "w:br"));
    const t = doc.createElementNS(NS_W, "w:t");
    t.setAttribute("xml:space", "preserve");
    t.textContent = l;
    r.appendChild(t);
    p.appendChild(r);
  });
}

export async function generarInforme(e: EntradaInforme): Promise<Buffer> {
  const zip = new PizZip(readFileSync(PLANTILLA));
  const paq = new Paquete(zip);
  const doc = parse(zip.file("word/document.xml")!.asText());
  const c = e.caso;
  const anio = c.fechas.ocurrencia.slice(0, 4);

  // ---------- 1. Marcadores simples (cuerpo, cabeceras y pies) ----------
  const tokens: Record<string, string> = {
    "{{liquidacion}}": c.liquidacion,
    "{{anio}}": anio,
    "{{siniestro}}": c.siniestro,
    "{{asegurado}}": c.asegurado.nombre,
    "{{ubicacion}}": c.ubicacion,
    "{{rut_asegurado}}": c.asegurado.rut,
    "{{poliza}}": c.poliza.numero,
    "{{item}}": c.poliza.item,
    "{{suma_asegurada}}": nf(c.poliza.sumaAseguradaUF),
    "{{f_inspeccion}}": c.fechas.inspeccion,
    "{{f_ocurrencia}}": dmy(c.fechas.ocurrencia),
    "{{f_emision}}": c.fechas.emision ?? MARCADOR_FALTA_DATO,
    "{{valor_uf}}": nf(e.valorUF),
    "{{vig_desde}}": c.poliza.vigenciaDesde,
    "{{vig_hasta}}": c.poliza.vigenciaHasta,
  };
  const partes = ["word/document.xml", ...Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d\.xml$/.test(n))];
  const docs: Record<string, Doc> = { "word/document.xml": doc };
  for (const n of partes.slice(1)) docs[n] = parse(zip.file(n)!.asText());
  for (const d of Object.values(docs))
    for (const [k, v] of Object.entries(tokens)) reemplazarGlobal(d.documentElement, k, v);

  // ---------- 2. Portada: tabla por etiquetas ----------
  const portada = porTag(doc, "tbl")[0];
  const filas = porTag(portada, "tr");
  const celdaValor = (etiqueta: string) => {
    const fila = filas.find((f) => textoDe(hijos(f).filter((x) => x.localName === "tc")[0]).trim() === etiqueta);
    return fila ? hijos(fila).filter((x) => x.localName === "tc")[1] : undefined;
  };
  const fijarCelda = (etiqueta: string, valor: string) => {
    const tc = celdaValor(etiqueta);
    const p = tc ? porTag(tc, "p")[0] : undefined;
    if (!p) return;
    reemplazarEnParrafo(p, /^[\s\S]+$/, () => valor);
  };
  fijarCelda("Fecha inspección", c.fechas.inspeccion);
  fijarCelda("Fecha asignación", c.fechas.asignacion);
  fijarCelda("Fecha denuncia", c.fechas.denuncia);
  fijarCelda("Fecha ocurrencia", dmy(c.fechas.ocurrencia));
  fijarCelda("Magnitud de los daños", "Pérdida parcial");
  const emision = filas.find((f) => /Fecha emisión de informe/.test(textoDe(f)));
  if (emision) {
    const ps = porTag(emision, "p");
    const p = ps.find((x) => /\d\d\/\d\d\/\d{4}|FALTA/.test(textoDe(x)));
    if (p) reemplazarEnParrafo(p, /\d\d\/\d\d\/\d{4}|\[FALTA[^\]]*\]/, () => (c.fechas.emision ? c.fechas.emision : FALTA));
  }
  // Cuantía: cuatro importes en UF, en este orden.
  const filaCuantia = filas.find((f) => /De la cuantía/.test(textoDe(f)));
  if (filaCuantia) {
    const valores = [
      e.caso.modo === "reclamacion" ? e.totales.reclamacionUF : e.totales.ajusteUF,
      e.totales.ajusteUF,
      c.poliza.deducibleUF,
      e.totales.indemnizacionUF,
    ];
    let k = 0;
    for (const p of porTag(filaCuantia, "p")) reemplazarEnParrafo(p, /\d{1,3}(\.\d{3})*,\d{2}/, () => nf(valores[k++] ?? 0));
  }

  // ---------- 3. Denuncia (entrada manual) ----------
  const pDenuncia = hijosCuerpo(doc).find((el) => el.localName === "p" && /^Frente|^“|\(SIC\)/.test(textoDe(el)));
  if (pDenuncia)
    reemplazarEnParrafo(pDenuncia, /^[\s\S]*\(SIC\)/, () => (c.denunciaTexto ? `“${c.denunciaTexto}” (SIC)` : FALTA));

  // ---------- 4. Características del bien en riesgo ----------
  const pCar = buscarP(doc, /Vivienda de xx pisos/);
  if (pCar) {
    const k = e.caracteristicas;
    const vals: Reemplazo[] = [
      datoOFalta(k.pisos),
      datoOFalta(k.superficie_m2),
      datoOFalta(k.antiguedad_anios),
      datoOFalta(k.dormitorios),
      datoOFalta(k.banos),
      datoOFalta(k.sistema_estructural),
      datoOFalta(k.techumbre),
      datoOFalta(k.cubierta),
      datoOFalta(k.pavimentos),
    ];
    reemplazarEnParrafo(pCar, /x{2,}/, (_m, i) => vals[i] ?? FALTA);
  }

  // Viñeta "•" propia: la numeración 1 de la plantilla usa un tilde (Wingdings).
  let numXml = zip.file("word/numbering.xml")!.asText();
  if (!numXml.includes('w:abstractNumId="90"')) {
    const absN =
      '<w:abstractNum w:abstractNumId="90"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#xF0B7;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum>';
    const i = numXml.indexOf("<w:num ");
    numXml = numXml.slice(0, i) + absN + numXml.slice(i);
    numXml = numXml.replace("</w:numbering>", '<w:num w:numId="90"><w:abstractNumId w:val="90"/></w:num></w:numbering>');
    zip.file("word/numbering.xml", numXml);
  }

  // ---------- 5. Evidencia observada (viñetas por recinto) ----------
  const pXxx = buscarP(doc, /^xxxxx$/);
  if (pXxx) {
    const rprModelo = porTag(buscarP(doc, /Evidencia observada/)!, "rPr").pop();
    const rprXml = rprModelo ? new (await import("@xmldom/xmldom")).XMLSerializer().serializeToString(rprModelo as never) : "";
    const base = rprXml.replace(/^<w:rPr[^>]*>|<\/w:rPr>$/g, "").replace(/<w:(b|i|u)\b[^>]*\/>/g, "");
    const rpr = (extra: string) => `<w:rPr>${base}${extra}</w:rPr>`;
    for (const ev of e.evidencia) {
      const m2 = ev.m2_acta != null ? ` ${nf(ev.m2_acta, ev.m2_acta % 1 ? 2 : 0)} m² según acta.` : "";
      const pXml =
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="90"/></w:numPr><w:spacing w:before="0" w:after="0"/><w:ind w:left="720" w:hanging="360"/><w:jc w:val="both"/></w:pPr>` +
        `<w:r>${rpr('<w:i/><w:u w:val="single"/>')}<w:t xml:space="preserve">${escXml(ev.recinto)}:</w:t></w:r>` +
        `<w:r>${rpr("")}<w:t xml:space="preserve"> ${escXml(ev.vineta)}${m2}${ev.atribuible ? "" : " No atribuible al siniestro."}</w:t></w:r></w:p>`;
      pXxx.parentNode!.insertBefore(crearEl(doc, pXml), pXxx);
    }
    pXxx.parentNode!.removeChild(pXxx);
  }

  // ---------- 6. Fachada y fotos por recinto ----------
  const tFachada = porTag(doc, "tbl").find((t) => /Fachada y numeración/.test(textoDe(t)));
  if (tFachada) {
    // La plantilla de origen trae fotos de otra vivienda (VML): se retiran siempre.
    for (const pic of porTag(tFachada, "pict")) pic.parentNode?.removeChild(pic);
    const celdas = porTag(tFachada, "tr")[0] ? hijos(porTag(tFachada, "tr")[0]).filter((x) => x.localName === "tc") : [];
    for (let i = 0; i < Math.min(2, e.fachada.length, celdas.length); i++) {
      const m = await paq.imagen(e.fachada[i], 3.45, { cover43: true });
      const p = porTag(celdas[i], "p")[0];
      p.appendChild(crearEl(doc, `<w:r>${xmlImagen(m.rid, m.cx, m.cy, `fachada-${i + 1}`)}</w:r>`));
    }
  }
  const pImgs = buscarP(doc, /Las siguientes imágenes dan cuenta/);
  if (pImgs) {
    // Quita los párrafos vacíos que reservaban espacio para pegar fotos a mano.
    for (let s = pImgs.nextSibling; s && s.nodeType; ) {
      const sig = s.nextSibling;
      if (s.nodeType === 1 && (s as Element).localName === "p" && textoDe(s as Element).trim() === "" && !porTag(s as Element, "drawing").length)
        s.parentNode!.removeChild(s);
      else if (s.nodeType === 1) break;
      s = sig as ChildNode;
    }
    // Una sola cuadrícula de 2 × 3 (varias si hay más fotos); la fachada, si existe, abre la primera como fila de cabecera.
    const celdas: FotoCelda[] = [];
    for (const f of e.fotos) celdas.push({ rid: (await paq.imagen(f.edicion && !esEdicionNula(f.edicion) ? await aplicarEdicion(f.buffer, f.edicion) : f.buffer, 0, { foto: true })).rid, leyenda: f.edicion?.leyenda ?? "", id: f.id, grupo: f.recinto });
    const fachada: FotoCelda | null = e.fachada[0] ? { rid: (await paq.imagen(e.fachada[0], 0, { foto: true })).rid, leyenda: "" } : null;
    let ancla: Node = pImgs;
    for (const xml of tablasPorGrupo(celdas, e.piesGrupos, fachada)) {
      const tabla = crearEl(doc, xml);
      ancla.parentNode!.insertBefore(tabla, ancla.nextSibling);
      const sep = crearEl(doc, `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`);
      ancla.parentNode!.insertBefore(sep, tabla.nextSibling);
      ancla = sep;
    }
  }

  // ---------- 7. Meteorología ----------
  const pCausa = buscarP(doc, /Causa origen de los daños/);
  if (pCausa) {
    const m = e.meteo;
    const vals: Reemplazo[] = [
      m?.precipitacionMm != null ? `${nf(m.precipitacionMm, 1)} mm ` : FALTA,
      m?.rafagaKmh != null ? `${nf(m.rafagaKmh, 1)} ` : { texto: `${MARCADOR_FALTA_DATO} `, negrita: true },
      m?.estacion ? `${m.estacion}, ` : { texto: `${MARCADOR_FALTA_DATO}, `, negrita: true },
    ];
    reemplazarEnParrafo(pCausa, /xxx( mm)? ?/, (_x, i) => vals[i] ?? FALTA);
  }
  const pMeteo = hijosCuerpo(doc).find((el) => el.localName === "p" && porTag(el, "drawing").length && /^\s*$/.test(textoDe(el)) && hijos(el).some((r) => /embed/.test(serializar(r as never)) ));
  const pGraf = hijosCuerpo(doc).find((el) => el.localName === "p" && el.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "blip").length && !/BECKETT/.test(textoDe(el)) && /rId19/.test(serializar(el as never)));
  const destino = pGraf ?? pMeteo;
  if (destino) {
    for (const r of porTag(destino, "r")) r.parentNode!.removeChild(r);
    if (e.meteo?.imagenPng) {
      const m = await paq.imagen(e.meteo.imagenPng, 6.44);
      destino.appendChild(crearEl(doc, `<w:r>${xmlImagen(m.rid, m.cx, m.cy, "meteorologia")}</w:r>`));
    } else {
      destino.appendChild(crearEl(doc, `<w:r><w:rPr><w:b/></w:rPr><w:t>${MARCADOR_FALTA_DATO} (captura de agrometeorologia.cl)</w:t></w:r>`));
    }
  }

  // ---------- 8. Siniestros anteriores ----------
  const pSin = buscarP(doc, /no presenta registro de siniestros anteriores/);
  if (pSin && !e.siniestrosAnteriores) {
    /* texto estándar: sin siniestros anteriores */
  }

  // ---------- 9. Valorizaciones ----------
  const pRec = buscarP(doc, /La reclamación presentada por el asegurado/);
  if (pRec) {
    if (c.modo === "reclamacion") {
      reemplazarEnParrafo(pRec, /\$ ?1(?=\s*\S?\s*UF)/, () => `$${pesos(e.totales.reclamacionPesos)}`);
      reemplazarEnParrafo(pRec, /\d+,\d{2}/, () => nf(e.totales.reclamacionUF));
    } else {
      reemplazarEnParrafo(pRec, /^[\s\S]+$/, () => "");
      reescribirCuerpo(pRec, 0, [
        "Pérdida determinada",
        "El asegurado ha solicitado la emisión de pérdida determinada, en base a los daños que hemos observado en la visita de inspección. Por lo que, hemos realizado una cuantificación de las reparaciones necesarias y relacionadas con el evento denunciado.",
      ]);
    }
  }
  const pAjuste = buscarP(doc, /^Se revisó que los valores unitarios/);
  if (pAjuste) {
    const lineas = e.ajusteTexto.split(/\n{1,}/).map((s) => s.trim()).filter(Boolean);
    const cierre =
      `No se aplicó descuento por depreciación, según lo establecido en póliza para una pérdida parcial. Se obtuvo como valor de pérdida UF ${nf(e.totales.ajusteUF)}. ` +
      `En cuanto al deducible no se pactó su aplicación. Así, el valor de indemnización asciende a UF ${nf(e.totales.indemnizacionUF)}. Ver cuadro de pérdida en siguiente página.`;
    reescribirCuerpo(pAjuste, 0, [...lineas, cierre]);
  }
  const pInfo = buscarP(doc, /Los términos expuestos han sido informados/);
  if (pInfo)
    reemplazarEnParrafo(pInfo, /el día\s+a través/, () => (c.fechas.informadoPartes ? `el día ${c.fechas.informadoPartes} a través` : FALTA));
  if (pInfo && !c.fechas.informadoPartes) {
    reemplazarEnParrafo(pInfo, /el día\s*$/, () => "el día ");
  }

  // ---------- 10. Cuadro de pérdida ----------
  const pTabla = buscarP(doc, /\$\{tabla_apu\}/);
  const pTitulo = buscarP(doc, /^CUADRO DE PÉRDIDA/);
  if (pTitulo) {
    // Antes del título había párrafos vacíos para empujar a otra página: se cambia por salto de página.
    for (let s = pTitulo.previousSibling; s; ) {
      const ant = s.previousSibling;
      if (s.nodeType === 1 && (s as Element).localName === "p" && textoDe(s as Element).trim() === "" && !porTag(s as Element, "br").length)
        s.parentNode!.removeChild(s);
      else if (s.nodeType === 1) break;
      s = ant as ChildNode;
    }
    const ppr = hijos(pTitulo).find((x) => x.localName === "pPr");
    if (ppr) ppr.insertBefore(doc.createElementNS(NS_W, "w:pageBreakBefore"), ppr.firstChild);
  }
  if (pTabla) {
    for (const r of porTag(pTabla, "r")) r.parentNode!.removeChild(r);
    let ancla: Node = pTabla;
    for (const xml of e.cuadroTabla) {
      const el = crearEl(doc, xml);
      ancla.parentNode!.insertBefore(el, ancla.nextSibling);
      ancla = el;
    }
  }

  // ---------- 11. Conclusión ----------
  const pConc = buscarP(doc, /^Con el mérito de lo expuesto/);
  if (pConc) reemplazarEnParrafo(pConc, /\d+,\d{2}/, () => nf(e.totales.indemnizacionUF));

  // ---------- 12. Control: sin marcadores sin resolver silenciosos ----------
  for (const [n, d] of Object.entries(docs)) {
    const txt = porTag(d, "p").map(textoDe).join("\n");
    if (/\{\{\w+\}\}|\$\{\w+\}/.test(txt)) throw new Error(`Quedaron marcadores sin reemplazar en ${n}`);
    zip.file(n, serializar(d));
  }
  // La imagen EMF del caso de origen ya no está referenciada: se retira.
  paq.cerrar();
  const relPath = "word/_rels/document.xml.rels";
  let rels = zip.file(relPath)!.asText();
  for (const img of ["image5.emf", "image3.jpeg", "image4.jpeg"]) {
    // Imágenes del caso de origen (gráfico y fachada): no deben viajar en el informe de otro siniestro.
    rels = rels.replace(new RegExp(`<Relationship [^>]*Target="media/${img.replace(".", "[.]")}"[^>]*/>`), "");
    zip.remove(`word/media/${img}`);
  }
  zip.file(relPath, rels);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
