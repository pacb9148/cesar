import type ExcelJS from "exceljs";
import { LETRAS_OBS, LEYENDA } from "../domain/constantes";
import type { Reclamacion } from "../domain/tipos";
import { auditarAjuste } from "../engine/auditoria";
import type { FilaCuadro } from "../engine/filas";
import { calcularTotales } from "../engine/totales";

const f = (formula: string, result: number): ExcelJS.CellFormulaValue => ({ formula, result });

/**
 * Hoja «Resumen» del Excel: lo reclamado frente a lo ajustado, el recorte, cuántas partidas llevan cada observación y el
 * resultado de las reglas duras. Los importes son fórmulas hacia EDIFICIO (se actualizan si se edita la planilla); el
 * conteo y la verificación reflejan el ajuste al momento de generarlo.
 */
export function agregarResumen(
  wb: ExcelJS.Workbook,
  o: { siniestro: string; reclamacion: Reclamacion; filas: FilaCuadro[]; valorUF: number; deducibleUF: number; dosColumnas: boolean; refs: Record<string, number> },
) {
  const viejo = wb.getWorksheet("Resumen");
  if (viejo) wb.removeWorksheet(viejo.id);
  const ws = wb.addWorksheet("Resumen");
  ws.columns = [{ width: 46 }, { width: 18 }, { width: 18 }, { width: 18 }];

  const lineas = o.filas.flatMap((x) => (x.tipo === "linea" ? [x] : []));
  const p = { ggPct: o.reclamacion.ggPct, utilidadPct: o.reclamacion.utilidadPct, ivaPct: o.reclamacion.ivaPct, valorUF: o.valorUF };
  const rec = calcularTotales(lineas.flatMap((x) => (x.rec ? [x.rec] : [])), p);
  const aj = calcularTotales(lineas.flatMap((x) => (x.aj ? [x.aj] : [])), p);
  const colRec = "F";
  const colAj = o.dosColumnas ? "J" : "F";

  const titulo = ws.getCell("A1");
  titulo.value = `Resumen del ajuste — Siniestro ${o.siniestro}`;
  titulo.font = { bold: true, size: 13 };
  ws.addRow([]);
  const cab = ws.addRow(["Concepto", o.dosColumnas ? "Reclamado" : "", "Ajustado", o.dosColumnas ? "Diferencia" : ""]);
  cab.font = { bold: true };
  cab.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    c.alignment = { horizontal: "center" };
  });

  const importe = (etiqueta: string, ref: string, r: number | null, a: number, fmt: string) => {
    const fila = ws.addRow([etiqueta]);
    const n = fila.number;
    if (o.dosColumnas && r != null) fila.getCell(2).value = f(`EDIFICIO!${colRec}${o.refs[ref]}`, r);
    fila.getCell(3).value = f(`EDIFICIO!${colAj}${o.refs[ref]}`, a);
    if (o.dosColumnas && r != null) fila.getCell(4).value = f(`C${n}-B${n}`, a - r);
    for (const c of [2, 3, 4]) {
      fila.getCell(c).numFmt = fmt;
      fila.getCell(c).alignment = { horizontal: "right" };
    }
  };
  importe("Total directo ($)", "dir", rec.directo, aj.directo, "#,##0");
  importe("Total neto ($)", "neto", rec.neto, aj.neto, "#,##0");
  importe("Total con IVA ($)", "tot", rec.total, aj.total, "#,##0");
  importe("Equivalente en moneda de póliza (UF)", "uf", rec.uf, aj.uf, "#,##0.00");
  const ind = ws.addRow(["Valor a indemnizar (UF)"]);
  ind.getCell(3).value = f(`EDIFICIO!${colAj}${o.refs.ind}`, aj.uf - o.deducibleUF);
  ind.getCell(3).numFmt = "#,##0.00";
  ind.font = { bold: true };
  if (o.dosColumnas && rec.total > 0) {
    const r = ws.addRow(["Valor ajustado como porcentaje de lo reclamado"]);
    r.getCell(3).value = f(`C${ind.number - 2}/B${ind.number - 2}`, aj.total / rec.total);
    r.getCell(3).numFmt = "0.0%";
  }

  const a = auditarAjuste(o.filas, o.reclamacion);
  ws.addRow([]);
  const t1 = ws.addRow([`Partidas leídas del presupuesto: ${a.partidasReclamadas} · ajustadas: ${a.partidasAjustadas}`]);
  t1.font = { bold: true };
  for (const l of LETRAS_OBS) {
    const fila = ws.addRow([`${l}: ${LEYENDA[l]}`, "", a.conteoObs[l]]);
    fila.getCell(1).alignment = { wrapText: true, vertical: "top" };
    fila.height = 15 * Math.ceil(LEYENDA[l].length / 48);
  }
  ws.addRow([]);
  const t2 = ws.addRow(["Reglas del ajuste (verificadas al generar)"]);
  t2.font = { bold: true };
  for (const v of a.verificaciones) {
    const fila = ws.addRow([`${v.codigo} — ${v.titulo}`, v.ok ? "Cumple" : "Revisar"]);
    fila.getCell(1).alignment = { wrapText: true, vertical: "top" };
    fila.height = 15 * Math.ceil((v.codigo.length + v.titulo.length + 3) / 48);
    fila.getCell(2).font = { bold: true, color: { argb: v.ok ? "FF046C4E" : "FFA11D1D" } };
  }
  ws.views = [{ state: "frozen", ySplit: 3 }];
  return ws;
}
