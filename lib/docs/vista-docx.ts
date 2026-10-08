import PizZip from "pizzip";
import { crearEl, hijos, NS_W, parse, porTag, serializar, textoDe, type Doc } from "./docx-xml";

/**
 * Vista editable del Word: el cuerpo se recorre en el mismo orden que usa la edición, así cada párrafo tiene un índice estable
 * (su posición entre todos los `w:p` del documento). Se puede cambiar el texto de los párrafos que no llevan imágenes; las tablas,
 * imágenes y el resto del documento no se tocan.
 */
export type RunVista = { t: string; b?: boolean; i?: boolean; u?: boolean; sz?: number; color?: string; sc?: boolean; salto?: boolean };
/** `fotoId` identifica la fotografía del caso (nombre de imagen `foto:<id>`): permite abrir su editor con doble clic. */
/** `idx` es la posición de la imagen entre todas las del documento (estable): sirve para cambiar su tamaño o quitarla. */
export type ImagenVista = { idx: number; src: string; w: number; h: number; fotoId?: string; nombre: string };
export type ParrafoVista = { tipo: "p"; i: number; jc?: "left" | "center" | "right" | "justify"; runs: RunVista[]; imagenes: ImagenVista[]; editable: boolean; texto: string; sangria?: number };
export type TablaVista = { tipo: "tabla"; anchos: number[]; filas: { celdas: { span: number; bloques: BloqueVista[] }[] }[] };
export type BloqueVista = ParrafoVista | TablaVista;

const MAX_TEXTO = 5000;
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" };

const val = (el: Element | undefined, attr = "val") => el?.getAttributeNS(NS_W, attr) ?? el?.getAttribute(`w:${attr}`) ?? undefined;
const hijo = (el: Element, tag: string) => hijos(el).find((c) => c.localName === tag);
const activo = (el: Element | undefined) => !!el && !["0", "false", "off"].includes(val(el) ?? "");

function relaciones(zip: PizZip): Map<string, string> {
  const m = new Map<string, string>();
  const x = zip.file("word/_rels/document.xml.rels")?.asText() ?? "";
  for (const r of x.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(r[0])?.[1];
    const target = /Target="([^"]+)"/.exec(r[0])?.[1];
    if (id && target) m.set(id, target);
  }
  return m;
}

const NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/** ¿Está dentro de la alternativa de compatibilidad (VML)? Word usa solo la primera: contarlas todas duplica lo que se ve. */
const enAlternativa = (el: Element): boolean => {
  for (let n = el.parentNode; n && n.nodeType === 1; n = n.parentNode) {
    const e = n as Element;
    if ((e.localName === "Fallback" && e.namespaceURI === NS_MC) || e.localName === "pict") return true;
  }
  return false;
};
const contenedorDe = (blip: Element): Element | null => {
  for (let n = blip.parentNode; n && n.nodeType === 1; n = n.parentNode) {
    const e = n as Element;
    if ((e.localName === "inline" || e.localName === "anchor") && e.namespaceURI === NS_WP) return e;
  }
  return null;
};

export type Dibujo = { idx: number; cont: Element; drawing: Element; blip: Element };

/** Imágenes reales del documento, en orden, una vez cada una (sin cuadros de texto vacíos ni alternativas de compatibilidad). */
export function dibujosDe(body: Element): Dibujo[] {
  const out: Dibujo[] = [];
  for (const drawing of porTag(body, "drawing")) {
    if (enAlternativa(drawing)) continue;
    const cont = hijos(drawing).find((c) => (c.localName === "inline" || c.localName === "anchor") && c.namespaceURI === NS_WP);
    if (!cont) continue;
    const blip = Array.from(cont.getElementsByTagNameNS(NS_A, "blip")).find((b) => contenedorDe(b) === cont);
    if (!blip) continue;
    out.push({ idx: out.length, cont, drawing, blip });
  }
  return out;
}

function imagenesDe(p: Element, dibujos: Map<Element, Dibujo>, zip: PizZip, rels: Map<string, string>): ImagenVista[] {
  const out: ImagenVista[] = [];
  for (const drawing of porTag(p, "drawing")) {
    const d = dibujos.get(drawing);
    if (!d) continue;
    const rid = d.blip.getAttributeNS(NS_R, "embed") ?? d.blip.getAttribute("r:embed");
    const ext = Array.from(d.cont.getElementsByTagNameNS(NS_WP, "extent"))[0];
    const destino = rid ? rels.get(rid) : undefined;
    if (!destino) continue;
    const e = (destino.split(".").pop() ?? "").toLowerCase();
    const archivo = zip.file(`word/${destino.replace(/^\//, "").replace(/^word\//, "")}`);
    if (!archivo || !MIME[e]) continue; // las imágenes EMF/VML no se pueden mostrar en el navegador
    const nombre = Array.from(d.cont.getElementsByTagNameNS(NS_WP, "docPr"))[0]?.getAttribute("name") ?? "";
    out.push({
      idx: d.idx,
      src: `data:${MIME[e]};base64,${Buffer.from(archivo.asUint8Array()).toString("base64")}`,
      w: Math.round(Number(ext?.getAttribute("cx") ?? 0) / 9525),
      h: Math.round(Number(ext?.getAttribute("cy") ?? 0) / 9525),
      fotoId: /^foto:[0-9a-f-]{36}$/i.test(nombre) ? nombre.slice(5) : undefined,
      nombre,
    });
  }
  return out;
}

function runsDe(p: Element): RunVista[] {
  const out: RunVista[] = [];
  const recorrer = (nodo: Element) => {
    for (const r of hijos(nodo)) {
      if (r.localName === "hyperlink" || r.localName === "smartTag" || r.localName === "ins") recorrer(r);
      if (r.localName !== "r") continue;
      const rpr = hijo(r, "rPr");
      const fmt: Omit<RunVista, "t"> = {
        b: activo(rpr && hijo(rpr, "b")) || undefined,
        i: activo(rpr && hijo(rpr, "i")) || undefined,
        u: (rpr && hijo(rpr, "u") && val(hijo(rpr, "u")) !== "none") || undefined,
        sz: rpr && hijo(rpr, "sz") ? Number(val(hijo(rpr, "sz"))) / 2 : undefined,
        color: rpr && hijo(rpr, "color") && /^[0-9A-Fa-f]{6}$/.test(val(hijo(rpr, "color")) ?? "") ? `#${val(hijo(rpr, "color"))}` : undefined,
        sc: activo(rpr && hijo(rpr, "smallCaps")) || undefined,
      };
      for (const c of hijos(r)) {
        if (c.localName === "t") out.push({ t: c.textContent ?? "", ...fmt });
        else if (c.localName === "tab") out.push({ t: "\t", ...fmt });
        else if (c.localName === "br" && val(c, "type") !== "page") out.push({ t: "", salto: true, ...fmt });
      }
    }
  };
  recorrer(p);
  return out;
}

export function docxAVista(buf: Buffer): { bloques: BloqueVista[]; parrafos: number } {
  const zip = new PizZip(buf);
  const doc: Doc = parse(zip.file("word/document.xml")!.asText());
  const body = doc.getElementsByTagNameNS(NS_W, "body")[0] as unknown as Element;
  const rels = relaciones(zip);
  const mapaDibujos = new Map(dibujosDe(body).map((d) => [d.drawing, d] as const));
  const indice = new Map<Element, number>(porTag(body, "p").map((p, i) => [p, i]));

  const parrafo = (p: Element): ParrafoVista => {
    const ppr = hijo(p, "pPr");
    const jc = ppr && hijo(ppr, "jc") ? val(hijo(ppr, "jc")) : undefined;
    const ind = ppr && hijo(ppr, "ind") ? Number(val(hijo(ppr, "ind"), "left") ?? val(hijo(ppr, "ind"), "start") ?? 0) : 0;
    const imagenes = imagenesDe(p, mapaDibujos, zip, rels);
    const runs = runsDe(p);
    return {
      tipo: "p",
      i: indice.get(p) ?? -1,
      jc: jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" ? "justify" : undefined,
      runs,
      imagenes,
      // Un párrafo con imágenes y texto se puede corregir (las imágenes se conservan); uno que solo es imagen, no.
      editable: (imagenes.length === 0 || textoDe(p).trim() !== "") && p.getElementsByTagNameNS(NS_W, "pict").length === 0,
      texto: textoDe(p),
      sangria: ind > 0 ? Math.round(ind / 15) : undefined,
    };
  };
  const bloquesDe = (el: Element): BloqueVista[] =>
    hijos(el).flatMap((c): BloqueVista[] => {
      if (c.localName === "p") return [parrafo(c)];
      if (c.localName === "tbl") return [tabla(c)];
      return [];
    });
  function tabla(t: Element): TablaVista {
    const grid = hijo(t, "tblGrid");
    const anchos = grid ? hijos(grid).map((g) => Math.round(Number(val(g, "w") ?? 0) / 15)) : [];
    const filas = hijos(t)
      .filter((r) => r.localName === "tr")
      .map((tr) => ({
        celdas: hijos(tr)
          .filter((tc) => tc.localName === "tc")
          .flatMap((tc) => {
            const pr = hijo(tc, "tcPr");
            const vm = pr && hijo(pr, "vMerge");
            if (vm && val(vm) !== "restart") return []; // continuación de una celda combinada verticalmente
            const span = pr && hijo(pr, "gridSpan") ? Number(val(hijo(pr, "gridSpan"))) : 1;
            return [{ span: span || 1, bloques: bloquesDe(tc) }];
          }),
      }));
    return { tipo: "tabla", anchos, filas };
  }
  return { bloques: bloquesDe(body), parrafos: indice.size };
}

export type RunEdicion = { t: string; b?: boolean; i?: boolean; u?: boolean };
export type EdicionesWord = {
  /** Contenido nuevo de párrafos existentes, por índice, con su formato (negrita, cursiva, subrayado). */
  parrafos?: Record<string, RunEdicion[]>;
  /** Párrafos nuevos después del párrafo indicado (copian su estilo de párrafo). */
  insertar?: { despuesDe: number; runs: RunEdicion[] }[];
  /** Párrafos a quitar (los únicos de una celda o con imágenes se vacían/respetan). */
  eliminar?: number[];
  /** Tamaño nuevo de imágenes (por `idx`), en EMU (1 cm = 360000). */
  imagenes?: { idx: number; cx: number; cy: number }[];
  /** Imágenes a quitar del documento (por `idx`). */
  quitarImagenes?: number[];
};


function construirRuns(doc: Doc, base: Element | undefined, runs: RunEdicion[], sinAdornos = false): Element[] {
  return runs
    .filter((r) => r.t !== "")
    .map((r) => {
      const run = crearEl(doc, `<w:r></w:r>`);
      const rpr = base ? (base.cloneNode(true) as Element) : doc.createElementNS(NS_W, "w:rPr");
      // Un párrafo nuevo toma la fuente y el tamaño del vecino, pero no sus adornos de título (versalitas, sombra).
      const quitar = sinAdornos ? ["b", "i", "u", "smallCaps", "caps", "shadow"] : ["b", "i", "u"];
      for (const c of hijos(rpr)) if (quitar.includes(c.localName ?? "")) rpr.removeChild(c);
      // El orden de los hijos de rPr importa para Word: b, i, ..., u van antes de color/sz/etc.
      if (r.u) rpr.insertBefore(doc.createElementNS(NS_W, "w:u"), rpr.firstChild);
      if (r.i) rpr.insertBefore(doc.createElementNS(NS_W, "w:i"), rpr.firstChild);
      if (r.b) rpr.insertBefore(doc.createElementNS(NS_W, "w:b"), rpr.firstChild);
      const u = hijos(rpr).find((c) => c.localName === "u");
      if (u) u.setAttributeNS(NS_W, "w:val", "single");
      if (hijos(rpr).length) run.appendChild(rpr);
      r.t.replace(/\r/g, "").split("\n").forEach((linea, n) => {
        if (n > 0) run.appendChild(crearEl(doc, `<w:br/>`));
        const t = crearEl(doc, `<w:t xml:space="preserve"></w:t>`);
        t.textContent = linea;
        run.appendChild(t);
      });
      return run;
    });
}

const tieneImagen = (p: Element) => p.getElementsByTagNameNS(NS_W, "drawing").length > 0 || p.getElementsByTagNameNS(NS_W, "pict").length > 0;
const esRunConObjeto = (r: Element) => r.getElementsByTagNameNS(NS_W, "drawing").length > 0 || r.getElementsByTagNameNS(NS_W, "pict").length > 0 || r.getElementsByTagNameNS(NS_MC, "AlternateContent").length > 0 || r.getElementsByTagNameNS(NS_W, "object").length > 0;
const baseRpr = (p: Element): Element | undefined => {
  const runs = hijos(p).filter((c) => c.localName === "r");
  const r = runs.find((x) => hijos(x).some((c) => c.localName === "t")) ?? runs[0];
  return r ? hijos(r).find((c) => c.localName === "rPr") : undefined;
};

/**
 * Aplica las ediciones del usuario al Word: contenido con formato de párrafos existentes, párrafos nuevos y párrafos quitados.
 * Todo se resuelve contra los índices originales (antes de insertar o quitar nada). Las imágenes y el resto no se tocan.
 */
export function aplicarEdiciones(buf: Buffer, e: EdicionesWord): { buffer: Buffer; aplicados: number } {
  const zip = new PizZip(buf);
  const doc: Doc = parse(zip.file("word/document.xml")!.asText());
  const body = doc.getElementsByTagNameNS(NS_W, "body")[0] as unknown as Element;
  const ps = porTag(body, "p");
  const de = (k: number | string) => {
    const p = ps[Number(k)];
    if (!Number.isInteger(Number(k)) || !p) throw new Error(`El párrafo ${k} no existe.`);
    return p;
  };
  const valida = (runs: RunEdicion[], k: number | string) => {
    if (runs.reduce((n, r) => n + r.t.length, 0) > MAX_TEXTO) throw new Error(`El párrafo ${k} supera ${MAX_TEXTO} caracteres.`);
  };
  let aplicados = 0;

  for (const [k, runs] of Object.entries(e.parrafos ?? {})) {
    const p = de(k);
    valida(runs, k);
    const rpr = baseRpr(p);
    // Las imágenes y objetos del párrafo se conservan: solo se reescriben los tramos de texto, antes del primer objeto.
    const objetos = hijos(p).filter((c) => c.localName === "r" && esRunConObjeto(c));
    // Un tramo puede traer a la vez texto y un objeto (p. ej. un título con una línea anclada): se le quita solo el texto.
    for (const r of objetos) for (const c of hijos(r)) if (["t", "tab", "br", "noBreakHyphen", "softHyphen"].includes(c.localName ?? "")) r.removeChild(c);
    for (const r of hijos(p).filter((c) => c.localName === "r" && !esRunConObjeto(c))) p.removeChild(r);
    for (const r of construirRuns(doc, rpr, runs)) p.insertBefore(r, objetos[0] ?? null);
    aplicados++;
  }
  // Imágenes: tamaño nuevo y quitadas, resueltas contra los índices originales.
  const dib = dibujosDe(body);
  for (const m of e.imagenes ?? []) {
    const d = dib[m.idx];
    if (!d) throw new Error(`La imagen ${m.idx} no existe.`);
    if (!(m.cx > 0 && m.cy > 0 && m.cx <= 10800000 && m.cy <= 10800000)) throw new Error("El tamaño de la imagen debe estar entre 0 y 30 cm.");
    const cx = String(Math.round(m.cx));
    const cy = String(Math.round(m.cy));
    const ext = Array.from(d.cont.getElementsByTagNameNS(NS_WP, "extent")).find((x) => x.parentNode === d.cont);
    ext?.setAttribute("cx", cx);
    ext?.setAttribute("cy", cy);
    // El tamaño también va en la propia imagen (pic:spPr/a:xfrm/a:ext), junto a su blip.
    const pic = d.blip.parentNode?.parentNode as Element | undefined;
    for (const x of pic ? Array.from(pic.getElementsByTagNameNS(NS_A, "ext")) : []) {
      x.setAttribute("cx", cx);
      x.setAttribute("cy", cy);
    }
    aplicados++;
  }
  for (const k of e.quitarImagenes ?? []) {
    const d = dib[k];
    if (!d) throw new Error(`La imagen ${k} no existe.`);
    // Se quita el tramo que la contiene (y su alternativa de compatibilidad, que va en el mismo tramo).
    let run: Node | null = d.drawing;
    while (run && !(run.nodeType === 1 && (run as Element).localName === "r")) run = run.parentNode;
    run?.parentNode?.removeChild(run);
    aplicados++;
  }
  for (const ins of e.insertar ?? []) {
    const ref = de(ins.despuesDe);
    valida(ins.runs, ins.despuesDe);
    const nuevo = doc.createElementNS(NS_W, "w:p");
    const ppr = hijos(ref).find((c) => c.localName === "pPr");
    if (ppr) {
      const copia = ppr.cloneNode(true) as Element;
      for (const c of hijos(copia)) if (["sectPr", "pageBreakBefore", "keepNext"].includes(c.localName ?? "")) copia.removeChild(c);
      nuevo.appendChild(copia);
    }
    for (const r of construirRuns(doc, baseRpr(ref), ins.runs, true)) nuevo.appendChild(r);
    ref.parentNode!.insertBefore(nuevo, ref.nextSibling);
    aplicados++;
  }
  for (const k of e.eliminar ?? []) {
    const p = de(k);
    if (tieneImagen(p)) continue;
    const padre = p.parentNode as Element;
    const soloEnCelda = padre.localName === "tc" && hijos(padre).filter((c) => c.localName === "p").length <= 1;
    if (soloEnCelda) for (const r of hijos(p).filter((c) => c.localName === "r")) p.removeChild(r);
    else padre.removeChild(p);
    aplicados++;
  }
  zip.file("word/document.xml", serializar(doc));
  return { buffer: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }), aplicados };
}
