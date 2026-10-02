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
