import { LETRAS_OBS, LEYENDA } from "../domain/constantes";
import { calcularTotales } from "../engine/totales";
import type { EntradaExcel } from "./excel";
import { armarFilas } from "../engine/filas";
import { escXml } from "./docx-xml";
import { htmlAPng } from "./navegador";

const n0 = (n: number) => Math.round(n).toLocaleString("es-CL");
const nc = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("es-CL", { maximumFractionDigits: 2 }));
const nf2 = (n: number) => n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type ResumenCuadro = {
  recDirecto: number;
  ajDirecto: number;
  recUF: number;
  ajUF: number;
  indemnizacionUF: number;
  recTotalPesos: number;
};

export function resumenCuadro(e: EntradaExcel): ResumenCuadro {
  const filas = armarFilas(e);
  const rec = calcularTotales(
    filas.flatMap((f) => (f.tipo === "linea" && f.rec ? [{ cantidad: f.rec.cantidad, pu: f.rec.pu }] : [])),
    { ggPct: e.reclamacion.ggPct, utilidadPct: e.reclamacion.utilidadPct, ivaPct: e.reclamacion.ivaPct, valorUF: e.valorUF },
  );
  const aj = calcularTotales(
    filas.flatMap((f) => (f.tipo === "linea" && f.aj ? [{ cantidad: f.aj.cantidad, pu: f.aj.pu }] : [])),
    { ggPct: e.reclamacion.ggPct, utilidadPct: e.reclamacion.utilidadPct, ivaPct: e.reclamacion.ivaPct, valorUF: e.valorUF },
  );
  return {
    recDirecto: rec.directo,
    ajDirecto: aj.directo,
    recUF: rec.uf,
    ajUF: aj.uf,
    indemnizacionUF: aj.uf - e.caso.poliza.deducibleUF,
    recTotalPesos: rec.total,
  };
}

export function cuadroHtml(e: EntradaExcel): string {
  const filas = armarFilas(e);
  const dos = e.caso.modo === "reclamacion";
  const rc = e.reclamacion;
  const r = resumenCuadro(e);
  const unif = rc.utilidadPct === 0;
  const recNeto = r.recDirecto * (1 + rc.ggPct + rc.utilidadPct);
  const ajNeto = r.ajDirecto * (1 + rc.ggPct + rc.utilidadPct);

  const cuerpo = filas
    .map((f) => {
      if (f.tipo === "seccion")
        return `<tr class="sec"><td>${escXml(f.item)}</td><td colspan="${dos ? 10 : 6}">${escXml(f.titulo)}</td></tr>`;
      const rec = f.rec
        ? `<td>${f.rec.um}</td><td class="n">${nc(f.rec.cantidad)}</td><td class="n">${n0(f.rec.pu)}</td><td class="n">${n0(f.rec.cantidad * f.rec.pu)}</td>`
        : `<td></td><td></td><td></td><td></td>`;
      const aj = f.aj
        ? `<td>${f.aj.um}</td><td class="n">${nc(f.aj.cantidad)}</td><td class="n">${n0(f.aj.pu)}</td><td class="n">${n0(f.aj.cantidad * f.aj.pu)}</td>`
        : `<td></td><td></td><td></td><td></td>`;
      return `<tr><td class="c">${escXml(f.item)}</td><td class="d">${escXml(f.descripcion)}</td>${dos ? rec + aj : aj}<td class="o">${f.obs.join(" ")}</td></tr>`;
    })
    .join("");

  const filaTot = (et: string, a: string, b: string, pct?: string) =>
    `<tr class="tot"><td></td><td>${et}${pct ? ` <span class="p">${pct}</span>` : ""}</td>${
      dos ? `<td colspan="4" class="n">${a}</td><td colspan="4" class="n">${b}</td>` : `<td colspan="4" class="n">${b}</td>`
    }<td></td></tr>`;

  const tot =
    filaTot("Total directo ($)", n0(r.recDirecto), n0(r.ajDirecto)) +
    filaTot(unif ? "Gastos generales y utilidades ($)" : "Gastos generales ($)", n0(r.recDirecto * rc.ggPct), n0(r.ajDirecto * rc.ggPct), `${Math.round(rc.ggPct * 100)}%`) +
    (unif ? "" : filaTot("Utilidades ($)", n0(r.recDirecto * rc.utilidadPct), n0(r.ajDirecto * rc.utilidadPct), `${Math.round(rc.utilidadPct * 100)}%`)) +
    filaTot("Total neto ($)", n0(recNeto), n0(ajNeto)) +
    filaTot("IVA ($)", n0(recNeto * rc.ivaPct), n0(ajNeto * rc.ivaPct), `${Math.round(rc.ivaPct * 100)}%`) +
    filaTot("Total con IVA ($)", n0(r.recTotalPesos), n0(ajNeto * (1 + rc.ivaPct))) +
    filaTot("Equivalente en moneda de póliza (UF)", nf2(r.recUF), nf2(r.ajUF)) +
    filaTot("Deducible contractual (UF)", "", nf2(e.caso.poliza.deducibleUF)) +
    `<tr class="tot fin"><td></td><td>Valor a indemnizar (UF)</td>${dos ? `<td colspan="4"></td>` : ""}<td colspan="4" class="n">${nf2(r.indemnizacionUF)}</td><td></td></tr>`;

  const leyenda = LETRAS_OBS.map((l) => `<div><b>${l}</b><span>${escXml(LEYENDA[l])}</span></div>`).join("");
  const fecha = e.caso.fechas.ocurrencia.split("-").reverse().join("-");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:14px 18px;background:#fff;color:#000;font:11px "Arial Narrow",Arial,sans-serif;width:${dos ? 1000 : 820}px}
  table{border-collapse:collapse;width:100%} td,th{padding:1px 4px;border:0}
  th{border:1px solid #000;font-weight:normal;text-align:center}
  td.n{text-align:right} td.c{text-align:center} td.o{text-align:center;white-space:nowrap}
  tr.sec td{font-weight:bold} tr.tot td{border-top:0} tr.fin td{border-top:1px solid #000;border-bottom:1px solid #000;font-weight:bold}
  .p{margin-left:6px} .params{margin:10px 0;font-size:10px} .leyenda{margin-top:10px;font-size:9px}
  .leyenda div{display:flex;gap:10px} .leyenda b{width:14px;text-align:center}
  </style></head><body>
  <table>
   <tr><th rowspan="2" style="width:34px">Ítem</th><th rowspan="2">Descripción de trabajos</th>
   ${dos ? `<th colspan="4">Reclamación</th><th colspan="4">Valor ajustado</th>` : `<th colspan="4">Valor ajustado</th>`}<th rowspan="2" style="width:40px">OBS</th></tr>
   <tr>${(dos ? [0, 1] : [0]).map(() => `<th>u/m</th><th>Cant.</th><th>P. Unit. ($)</th><th>Total ($)</th>`).join("")}</tr>
   ${cuerpo}${tot}
  </table>
  <div class="params">Moneda de Póliza: UF &nbsp; · &nbsp; Fecha de Pérdida: ${fecha} &nbsp; · &nbsp; Indicador para FDP: ${nf2(e.valorUF)}</div>
  <div class="leyenda"><b>Observaciones</b>${leyenda}</div>
  </body></html>`;
}

export async function cuadroPng(e: EntradaExcel): Promise<Buffer> {
  return htmlAPng(cuadroHtml(e), e.caso.modo === "reclamacion" ? 1040 : 860, 2);
}

const FUENTE = '<w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow" w:cs="Arial Narrow"/>';

/**
 * El mismo cuadro de pérdida como tabla nativa de Word (y la leyenda de observaciones), para cuando el servidor no tiene
 * navegador con el que dibujar la imagen. Devuelve el XML de la tabla y de cada párrafo de la leyenda, en orden.
 */
export function cuadroTablaXml(e: EntradaExcel): string[] {
  const filas = armarFilas(e);
  const dos = e.caso.modo === "reclamacion";
  const rc = e.reclamacion;
  const r = resumenCuadro(e);
  const unif = rc.utilidadPct === 0;
  const recNeto = r.recDirecto * (1 + rc.ggPct + rc.utilidadPct);
  const ajNeto = r.ajDirecto * (1 + rc.ggPct + rc.utilidadPct);
  const bloque = [420, 560, 760, 900];
  const W = dos ? [480, 3848, ...bloque, ...bloque, 480] : [480, 6488, ...bloque, 480];
  const rpr = (b: boolean) => `<w:rPr>${FUENTE}${b ? "<w:b/>" : ""}<w:sz w:val="14"/></w:rPr>`;
  type Op = { span?: number; jc?: "left" | "center" | "right"; b?: boolean; borde?: boolean; vm?: "restart" | "cont" };
  const tc = (txt: string, w: number, o: Op = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.span && o.span > 1 ? `<w:gridSpan w:val="${o.span}"/>` : ""}${o.vm ? (o.vm === "restart" ? '<w:vMerge w:val="restart"/>' : "<w:vMerge/>") : ""}${o.borde ? '<w:tcBorders><w:top w:val="single" w:sz="4" w:color="000000"/><w:left w:val="single" w:sz="4" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:color="000000"/><w:right w:val="single" w:sz="4" w:color="000000"/></w:tcBorders>' : ""}<w:vAlign w:val="center"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${o.jc ?? "left"}"/></w:pPr>${txt ? `<w:r>${rpr(!!o.b)}<w:t xml:space="preserve">${escXml(txt)}</w:t></w:r>` : ""}</w:p></w:tc>`;
  const fila = (celdas: string[], cab = false) => `<w:tr><w:trPr><w:cantSplit/>${cab ? "<w:tblHeader/>" : ""}</w:trPr>${celdas.join("")}</w:tr>`;
  const sumaW = (desde: number, n: number) => W.slice(desde, desde + n).reduce((a, b) => a + b, 0);
  const iniAj = dos ? 6 : 2;

  const cab1 = [tc("Ítem", W[0], { jc: "center", borde: true, vm: "restart" }), tc("Descripción de trabajos", W[1], { jc: "center", borde: true, vm: "restart" })];
  if (dos) cab1.push(tc("Reclamación", sumaW(2, 4), { span: 4, jc: "center", borde: true }));
  cab1.push(tc("Valor ajustado", sumaW(iniAj, 4), { span: 4, jc: "center", borde: true }), tc("OBS", W[W.length - 1], { jc: "center", borde: true, vm: "restart" }));
  const sub = (ini: number) => ["u/m", "Cant.", "P. Unit. ($)", "Total ($)"].map((t, i) => tc(t, W[ini + i], { jc: "center", borde: true }));
  const cab2 = [tc("", W[0], { vm: "cont", borde: true }), tc("", W[1], { vm: "cont", borde: true }), ...(dos ? sub(2) : []), ...sub(iniAj), tc("", W[W.length - 1], { vm: "cont", borde: true })];

  const valores = (v: { um: string; cantidad: number; pu: number } | null, ini: number) =>
    v
      ? [tc(v.um, W[ini], { jc: "center" }), tc(nc(v.cantidad), W[ini + 1], { jc: "right" }), tc(n0(v.pu), W[ini + 2], { jc: "right" }), tc(n0(v.cantidad * v.pu), W[ini + 3], { jc: "right" })]
      : [0, 1, 2, 3].map((i) => tc("", W[ini + i]));

  const cuerpo = filas.map((f) =>
    f.tipo === "seccion"
      ? fila([tc(f.item, W[0], { jc: "center", b: true }), tc(f.titulo, sumaW(1, W.length - 1), { span: W.length - 1, b: true })])
      : fila([tc(f.item, W[0], { jc: "center" }), tc(f.descripcion, W[1]), ...(dos ? valores(f.rec, 2) : []), ...valores(f.aj, iniAj), tc(f.obs.join(" "), W[W.length - 1], { jc: "center" })]),
  );

  const total = (et: string, a: string, b: string, fin = false) =>
    fila([
      tc("", W[0]),
      tc(et, W[1], { b: fin }),
      ...(dos ? [tc(a, sumaW(2, 4), { span: 4, jc: "right", b: fin })] : []),
      tc(b, sumaW(iniAj, 4), { span: 4, jc: "right", b: fin }),
      tc("", W[W.length - 1]),
    ]);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const totales = [
    total("Total directo ($)", n0(r.recDirecto), n0(r.ajDirecto)),
    total(unif ? `Gastos generales y utilidades ($) ${pct(rc.ggPct)}` : `Gastos generales ($) ${pct(rc.ggPct)}`, n0(r.recDirecto * rc.ggPct), n0(r.ajDirecto * rc.ggPct)),
    ...(unif ? [] : [total(`Utilidades ($) ${pct(rc.utilidadPct)}`, n0(r.recDirecto * rc.utilidadPct), n0(r.ajDirecto * rc.utilidadPct))]),
    total("Total neto ($)", n0(recNeto), n0(ajNeto)),
    total(`IVA ($) ${pct(rc.ivaPct)}`, n0(recNeto * rc.ivaPct), n0(ajNeto * rc.ivaPct)),
    total("Total con IVA ($)", n0(r.recTotalPesos), n0(ajNeto * (1 + rc.ivaPct))),
    total("Equivalente en moneda de póliza (UF)", nf2(r.recUF), nf2(r.ajUF)),
    total("Deducible contractual (UF)", "", nf2(e.caso.poliza.deducibleUF)),
    total("Valor a indemnizar (UF)", "", nf2(r.indemnizacionUF), true),
  ];

  const tabla =
    `<w:tbl><w:tblPr><w:tblW w:w="${sumaW(0, W.length)}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${W.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${fila(cab1, true)}${fila(cab2, true)}${cuerpo.join("")}${totales.join("")}</w:tbl>`;
  const par = (t: string, b = false) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r>${rpr(b)}<w:t xml:space="preserve">${escXml(t)}</w:t></w:r></w:p>`;
  const fecha = e.caso.fechas.ocurrencia.split("-").reverse().join("-");
  return [
    tabla,
    par(`Moneda de Póliza: UF  ·  Fecha de Pérdida: ${fecha}  ·  Indicador para FDP: ${nf2(e.valorUF)}`),
    par("Observaciones", true),
    ...LETRAS_OBS.map((l) => par(`${l}   ${LEYENDA[l]}`)),
  ];
}
