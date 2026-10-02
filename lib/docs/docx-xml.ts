import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";

export type Doc = Document;
export const parse = (xml: string): Doc => new DOMParser().parseFromString(xml, "text/xml") as unknown as Doc;
export const serializar = (d: Doc): string => new XMLSerializer().serializeToString(d as never);

export const hijos = (el: Node): Element[] => {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
};
export const porTag = (el: Element | Document, tag: string): Element[] =>
  Array.from((el as Element).getElementsByTagNameNS(NS_W, tag)) as Element[];
const localName = (e: Element) => e.localName ?? e.nodeName.replace(/^.*:/, "");

export function textoDe(el: Element): string {
  return porTag(el, "t").map((t) => t.textContent ?? "").join("");
}

/** Une runs contiguos con el mismo formato para que un texto no quede partido entre varios. */
export function normalizarRuns(p: Element) {
  const ser = new XMLSerializer();
  const soloTexto = (r: Element) => hijos(r).every((c) => ["rPr", "t"].includes(localName(c)));
  let r = hijos(p).find((c) => localName(c) === "r");
  while (r) {
    let sig: Element | null = r.nextSibling as Element | null;
    while (sig && sig.nodeType !== 1) sig = sig.nextSibling as Element | null;
    if (sig && localName(sig) === "r" && soloTexto(r) && soloTexto(sig)) {
      const rp1 = hijos(r).find((c) => localName(c) === "rPr");
      const rp2 = hijos(sig).find((c) => localName(c) === "rPr");
      const clave = (x?: Element) => (x ? ser.serializeToString(x as never).replace(/ w:rsid\w*="[^"]*"/g, "") : "");
      const t1 = hijos(r).find((c) => localName(c) === "t");
      const t2 = hijos(sig).find((c) => localName(c) === "t");
      if (t1 && t2 && clave(rp1) === clave(rp2)) {
        t1.textContent = (t1.textContent ?? "") + (t2.textContent ?? "");
        t1.setAttribute("xml:space", "preserve");
        p.removeChild(sig);
        continue;
      }
    }
    let n: Element | null = r.nextSibling as Element | null;
    while (n && !(n.nodeType === 1 && localName(n) === "r")) n = n.nextSibling as Element | null;
    r = n as Element;
  }
}

export type Reemplazo = { texto: string; negrita?: boolean } | string;

/**
 * Reemplaza coincidencias de `re` en un párrafo aunque estén partidas entre runs.
 * Las coincidencias se resuelven en orden: `fn` recibe el índice para asignar valores en secuencia.
 */
export function reemplazarEnParrafo(p: Element, re: RegExp, fn: (m: RegExpExecArray, i: number) => Reemplazo): number {
  normalizarRuns(p);
  const ts = porTag(p, "t");
  const textos = ts.map((t) => t.textContent ?? "");
  const full = textos.join("");
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const rx = new RegExp(re.source, flags);
  const matches: { m: RegExpExecArray; rep: { texto: string; negrita?: boolean } }[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = rx.exec(full))) {
    if (m[0] === "") {
      rx.lastIndex++;
      continue;
    }
    const r = fn(m, i++);
    matches.push({ m, rep: typeof r === "string" ? { texto: r } : r });
  }
  if (!matches.length) return 0;
  const inicios: number[] = [];
  let acc = 0;
  for (const t of textos) {
    inicios.push(acc);
    acc += t.length;
  }
  const nodoDe = (pos: number) => {
    for (let k = ts.length - 1; k >= 0; k--) if (pos >= inicios[k]) return k;
    return 0;
  };
  const cur = textos.slice();
  const run = (t: Element) => t.parentNode as Element;
  for (const { m: mm, rep } of matches.slice().reverse()) {
    const s = mm.index;
    const e = s + mm[0].length;
    const a = nodoDe(s);
    const b = nodoDe(Math.max(s, e - 1));
    const pre = cur[a].slice(0, s - inicios[a]);
    const post = cur[b].slice(e - inicios[b]);
    const tA = ts[a];
    const tB = ts[b];
    const fijar = (t: Element, v: string) => {
      t.textContent = v;
      t.setAttribute("xml:space", "preserve");
    };
    if (!rep.negrita) {
      if (a === b) fijar(tA, pre + rep.texto + post);
      else {
        fijar(tA, pre + rep.texto);
        for (let k = a + 1; k < b; k++) fijar(ts[k], "");
        fijar(tB, post);
      }
      cur[a] = tA.textContent ?? "";
      if (a !== b) cur[b] = tB.textContent ?? "";
      continue;
    }
    // Reemplazo en negrita: va en un run propio con el mismo formato.
    const runA = run(tA);
    const doc = runA.ownerDocument;
    const nuevo = doc.createElementNS(NS_W, "w:r");
    const rpr = hijos(runA).find((c) => localName(c) === "rPr");
    const rprN = rpr ? (rpr.cloneNode(true) as Element) : doc.createElementNS(NS_W, "w:rPr");
    if (!hijos(rprN).some((c) => localName(c) === "b")) rprN.insertBefore(doc.createElementNS(NS_W, "w:b"), rprN.firstChild);
    nuevo.appendChild(rprN);
    const tn = doc.createElementNS(NS_W, "w:t");
    fijar(tn, rep.texto);
    nuevo.appendChild(tn);
    if (a === b) {
      // Lo que sigue al <w:t> en el run original (saltos de línea) pasa al run posterior.
      const resto: Node[] = [];
      for (let n = tA.nextSibling; n; n = n.nextSibling) resto.push(n);
      const runPost = doc.createElementNS(NS_W, "w:r");
      if (rpr) runPost.appendChild(rpr.cloneNode(true));
      const tp = doc.createElementNS(NS_W, "w:t");
      fijar(tp, post);
      runPost.appendChild(tp);
      resto.forEach((n) => runPost.appendChild(n));
      fijar(tA, pre);
      cur[a] = pre; // el resto del texto quedó en runPost: las coincidencias anteriores no deben volver a verlo
      runA.parentNode!.insertBefore(nuevo, runA.nextSibling);
      runA.parentNode!.insertBefore(runPost, nuevo.nextSibling);
    } else {
      fijar(tA, pre);
      for (let k = a + 1; k < b; k++) fijar(ts[k], "");
      fijar(tB, post);
      cur[a] = pre;
      cur[b] = post;
      runA.parentNode!.insertBefore(nuevo, runA.nextSibling);
    }
  }
  return matches.length;
}

/** Reemplazo literal en todo un subárbol (cuerpo, tablas, cabeceras, pies). */
export function reemplazarGlobal(raiz: Element | Document, de: string, a: string) {
  const re = new RegExp(de.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  for (const p of porTag(raiz, "p")) reemplazarEnParrafo(p, re, () => a);
}

export function crearEl(doc: Doc, xml: string): Element {
  const wrap = parse(
    `<r xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}">${xml}</r>`,
  );
  const el = hijos(wrap.documentElement)[0];
  return doc.importNode(el as never, true) as unknown as Element;
}

let seq = 9000;
export function xmlImagen(rid: string, cx: number, cy: number, nombre: string): string {
  const id = ++seq;
  return (
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="${nombre}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${nombre}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
}

export const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
