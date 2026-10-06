import { LETRAS_OBS, LEYENDA } from "../domain/constantes";
import { calcularTotales } from "../engine/totales";
import type { EntradaExcel } from "./excel";
import { armarFilas } from "../engine/filas";
import { escXml } from "./docx-xml";

export const n0 = (n: number) => Math.round(n).toLocaleString("es-CL");
const nc = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("es-CL", { maximumFractionDigits: 2 }));
export const nf2 = (n: number) => n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

export const MARCA_CUADRO = "cuadro-de-perdida";
const FUENTE = '<w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow" w:cs="Arial Narrow"/>';

/**
 * El cuadro de pérdida como tabla nativa de Word (con la leyenda de observaciones): se puede editar y se actualiza sola al editar el Excel. Devuelve el XML de la tabla (con la leyenda dentro), identificada por `MARCA_CUADRO`.
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

  const fecha = e.caso.fechas.ocurrencia.split("-").reverse().join("-");
  const nCols = W.length;
  const filaTexto = (t: string, b = false) => fila([tc(t, sumaW(0, nCols), { span: nCols, b })]);
  const leyenda = [
    filaTexto(`Moneda de Póliza: UF  ·  Fecha de Pérdida: ${fecha}  ·  Indicador para FDP: ${nf2(e.valorUF)}`),
    filaTexto("Observaciones", true),
    ...LETRAS_OBS.map((l) => filaTexto(`${l}   ${LEYENDA[l]}`)),
  ];
  // `tblCaption` marca la tabla: al editar el Excel se reemplaza por una nueva con los valores actualizados.
  const tabla =
    `<w:tbl><w:tblPr><w:tblW w:w="${sumaW(0, nCols)}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar><w:tblCaption w:val="${MARCA_CUADRO}"/></w:tblPr>` +
    `<w:tblGrid>${W.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${fila(cab1, true)}${fila(cab2, true)}${cuerpo.join("")}${totales.join("")}${leyenda.join("")}</w:tbl>`;
  return [tabla];
}
