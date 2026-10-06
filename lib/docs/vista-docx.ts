import PizZip from "pizzip";
import { crearEl, hijos, NS_W, parse, porTag, serializar, textoDe, type Doc } from "./docx-xml";

/**
 * Vista editable del Word: el cuerpo se recorre en el mismo orden que usa la edición, así cada párrafo tiene un índice estable
 * (su posición entre todos los `w:p` del documento). Se puede cambiar el texto de los párrafos que no llevan imágenes; las tablas,
 * imágenes y el resto del documento no se tocan.
 */
export type RunVista = { t: string; b?: boolean; i?: boolean; u?: boolean; sz?: number; color?: string; sc?: boolean; salto?: boolean };
export type ImagenVista = { src: string; w: number; h: number };
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

function imagenesDe(p: Element, zip: PizZip, rels: Map<string, string>): ImagenVista[] {
  const out: ImagenVista[] = [];
  for (const d of Array.from(p.getElementsByTagNameNS(NS_WP, "inline")).concat(Array.from(p.getElementsByTagNameNS(NS_WP, "anchor")))) {
    const blip = d.getElementsByTagNameNS(NS_A, "blip")[0];
    const rid = blip?.getAttributeNS(NS_R, "embed") ?? blip?.getAttribute("r:embed");
    const ext = d.getElementsByTagNameNS(NS_WP, "extent")[0];
    const destino = rid ? rels.get(rid) : undefined;
    if (!destino) continue;
    const e = (destino.split(".").pop() ?? "").toLowerCase();
    const archivo = zip.file(`word/${destino.replace(/^\//, "").replace(/^word\//, "")}`);
    if (!archivo || !MIME[e]) continue; // las imágenes EMF/VML no se pueden mostrar en el navegador
    out.push({ src: `data:${MIME[e]};base64,${Buffer.from(archivo.asUint8Array()).toString("base64")}`, w: Math.round(Number(ext?.getAttribute("cx") ?? 0) / 9525), h: Math.round(Number(ext?.getAttribute("cy") ?? 0) / 9525) });
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
  const indice = new Map<Element, number>(porTag(body, "p").map((p, i) => [p, i]));

  const parrafo = (p: Element): ParrafoVista => {
    const ppr = hijo(p, "pPr");
    const jc = ppr && hijo(ppr, "jc") ? val(hijo(ppr, "jc")) : undefined;
    const ind = ppr && hijo(ppr, "ind") ? Number(val(hijo(ppr, "ind"), "left") ?? val(hijo(ppr, "ind"), "start") ?? 0) : 0;
    const imagenes = imagenesDe(p, zip, rels);
    const runs = runsDe(p);
    return {
      tipo: "p",
      i: indice.get(p) ?? -1,
      jc: jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" ? "justify" : undefined,
      runs,
      imagenes,
      editable: imagenes.length === 0 && p.getElementsByTagNameNS(NS_W, "drawing").length === 0 && p.getElementsByTagNameNS(NS_W, "pict").length === 0,
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

/**
 * Cambia el texto de los párrafos indicados (por su índice). El párrafo conserva el formato de su primer tramo de texto y sus
 * imágenes; los párrafos con imágenes no se editan. Devuelve el .docx nuevo.
 */
export function aplicarTextos(buf: Buffer, cambios: Record<string, string>): { buffer: Buffer; aplicados: number } {
  const zip = new PizZip(buf);
  const doc: Doc = parse(zip.file("word/document.xml")!.asText());
  const body = doc.getElementsByTagNameNS(NS_W, "body")[0] as unknown as Element;
  const ps = porTag(body, "p");
  let aplicados = 0;
  for (const [k, nuevo] of Object.entries(cambios)) {
    const i = Number(k);
    const p = ps[i];
    if (!Number.isInteger(i) || !p) throw new Error(`El párrafo ${k} no existe.`);
    if (nuevo.length > MAX_TEXTO) throw new Error(`El párrafo ${k} supera ${MAX_TEXTO} caracteres.`);
    if (p.getElementsByTagNameNS(NS_W, "drawing").length || p.getElementsByTagNameNS(NS_W, "pict").length) continue;
    const texto = nuevo.replace(/\r/g, "");
    if (texto === textoDe(p)) continue;
    const runs = hijos(p).filter((c) => c.localName === "r");
    const primero = runs.find((r) => hijo(r, "t")) ?? runs[0];
    const rpr = primero ? hijo(primero, "rPr") : undefined;
    for (const r of runs) p.removeChild(r);
    const run = crearEl(doc, `<w:r></w:r>`);
    if (rpr) run.appendChild(rpr.cloneNode(true));
    texto.split("\n").forEach((linea, n) => {
      if (n > 0) run.appendChild(crearEl(doc, `<w:br/>`));
      const t = crearEl(doc, `<w:t xml:space="preserve"></w:t>`);
      t.textContent = linea;
      run.appendChild(t);
    });
    p.appendChild(run);
    aplicados++;
  }
  zip.file("word/document.xml", serializar(doc));
  return { buffer: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }), aplicados };
}
