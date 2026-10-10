import ExcelJS from "exceljs";
import { join } from "node:path";
import { LETRAS_OBS, LEYENDA } from "../domain/constantes";
import type { DatosCaso, DecisionLinea, LineaAdicional, Reclamacion } from "../domain/tipos";
import type { Recinto } from "../engine/cubicacion";
import { armarFilas } from "../engine/filas";
import { agregarResumen } from "./resumen-excel";
export { armarFilas };

export type SiniestroAnterior = {
  numero: string;
  fecha: string;
  montoUF: number;
  causa: string;
  direccion: string;
  relacion: string;
};

export type EntradaExcel = {
  caso: DatosCaso;
  reclamacion: Reclamacion;
  decisiones: DecisionLinea[];
  adicionales: LineaAdicional[];
  valorUF: number;
  recintos: Recinto[];
  siniestrosAnteriores: SiniestroAnterior[];
};

const PLANTILLA = join(process.cwd(), "plantillas", "ajuste-base.xlsx");
const COLS = 13;

type EstiloFila = Partial<ExcelJS.Style>[];
const estilos = (ws: ExcelJS.Worksheet, fila: number): EstiloFila =>
  Array.from({ length: COLS }, (_, i) => structuredClone(ws.getRow(fila).getCell(i + 1).style));
function aplicar(ws: ExcelJS.Worksheet, fila: number, st: EstiloFila) {
  st.forEach((s, i) => (ws.getRow(fila).getCell(i + 1).style = structuredClone(s) as ExcelJS.Style));
}
const f = (formula: string, result: number): ExcelJS.CellFormulaValue => ({ formula, result });

/** Anchos (en caracteres de Excel) pensados para leer la planilla sin tocar nada; el usuario puede cambiarlos cuando quiera. */
const ANCHOS: Record<number, number> = { 1: 13, 2: 54, 3: 8, 4: 10, 5: 13, 6: 15, 7: 8, 8: 10, 9: 13, 10: 15, 11: 6, 12: 6, 13: 6 };
const ANCHO_DESCRIPCION = ANCHOS[2];

const relleno = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

/** Especificación ACAS: encabezado gris D9D9D9 en negrita y centrado; títulos de sección (.0) en F2F2F2 y negrita. */
function pintarEncabezado(ws: ExcelJS.Worksheet) {
  for (const r of [10, 11])
    for (let c = 1; c <= COLS; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.fill = relleno("FFD9D9D9");
      cell.font = { ...cell.font, bold: true };
      cell.alignment = { ...cell.alignment, horizontal: c === 2 ? "left" : "center", vertical: "middle", wrapText: true };
    }
}
function pintarSeccion(ws: ExcelJS.Worksheet, r: number) {
  for (let c = 1; c <= COLS; c++) {
    const cell = ws.getRow(r).getCell(c);
    cell.fill = relleno("FFF2F2F2");
    cell.font = { ...cell.font, bold: true };
  }
}
/** Cantidades a la derecha, con decimales solo si los hay; y el alto de la fila crece con las líneas de la descripción. */
function formatearLinea(ws: ExcelJS.Worksheet, r: number, descripcion: string) {
  for (const c of [4, 8]) {
    const cell = ws.getCell(r, c);
    if (typeof cell.value !== "number") continue;
    cell.numFmt = Number.isInteger(cell.value) ? "#,##0" : "#,##0.00";
    cell.alignment = { ...cell.alignment, horizontal: "right", vertical: "middle" };
  }
  const lineas = Math.max(1, Math.ceil(descripcion.length / (ANCHO_DESCRIPCION * 1.05)));
  ws.getRow(r).height = Math.max(15, 13.5 * lineas + 1.5);
}

export async function generarExcel(e: EntradaExcel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(PLANTILLA);
  const ws = wb.getWorksheet("EDIFICIO");
  if (!ws) throw new Error("La plantilla no tiene hoja EDIFICIO");

  // Prototipos de estilo tomados de la planilla emitida: el formato sale de ahí, no de código.
  const P = {
    seccion: estilos(ws, 12),
    linea: estilos(ws, 13),
    blanco: estilos(ws, 60),
    total: [61, 62, 63, 64, 65, 66, 67, 68].map((r) => estilos(ws, r)),
    param: [70, 71, 72].map((r) => estilos(ws, r)),
    obsTitulo: estilos(ws, 74),
    obsLinea: estilos(ws, 75),
  };
  const ultimaPlantilla = ws.rowCount;
  for (const m of [...(ws.model.merges ?? [])]) {
    const fila = Number(/\d+/.exec(m)?.[0] ?? 0);
    if (fila >= 12) ws.unMergeCells(m);
  }
  for (let r = 12; r <= ultimaPlantilla + 2; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= COLS; c++) {
      row.getCell(c).value = null;
      row.getCell(c).style = {};
    }
  }

  const dosColumnas = e.caso.modo === "reclamacion";
  const c = e.caso;
  const set = (a: string, v: ExcelJS.CellValue) => (ws.getCell(a).value = v);
  set("B1", "Temporal");
  set("B2", c.aseguradora);
  set("B3", c.asegurado.nombre);
  set("B4", new Date(`${c.fechas.ocurrencia}T00:00:00Z`));
  set("B5", Number(c.siniestro));
  set("B6", c.ubicacion);
  set("B7", `UF ${c.poliza.sumaAseguradaUF.toLocaleString("es-CL", { minimumFractionDigits: 2 })} Edificio`);
  set("B8", "DM causados por riesgo de la naturaleza");

  if (!dosColumnas) {
    // Pérdida determinada: una sola columna de valores, como en la planilla emitida del caso 2.
    for (const m of ["C10:F10", "G10:J10", "K10:M11"]) {
      try {
        ws.unMergeCells(m);
      } catch {
        /* ya estaba suelta */
      }
    }
    set("C10", "Valor ajustado");
    ws.mergeCells("C10:F10");
    for (const a of ["G10", "H10", "I10", "J10", "K10", "L10", "M10", "K11", "L11", "M11", "G11", "H11", "I11", "J11"]) set(a, null);
    set("G10", "OBS");
    ws.mergeCells("G10:G11");
  }

  pintarEncabezado(ws);
  for (const [c, w] of Object.entries(ANCHOS)) ws.getColumn(Number(c)).width = w;
  ws.views = [{ state: "frozen", ySplit: 11, xSplit: 2 }];

  const filas = armarFilas(e);
  let r = 12;
  const primera = 12;
  let ultima = 12;
  for (const fila of filas) {
    if (fila.tipo === "seccion") {
      aplicar(ws, r, P.seccion);
      pintarSeccion(ws, r);
      ws.getCell(r, 1).value = fila.item;
      ws.getCell(r, 2).value = fila.titulo;
      r++;
      continue;
    }
    aplicar(ws, r, P.linea);
    ws.getCell(r, 1).value = fila.item;
    ws.getCell(r, 2).value = fila.descripcion;
    if (dosColumnas) {
      if (fila.rec) {
        ws.getCell(r, 3).value = fila.rec.um;
        ws.getCell(r, 4).value = fila.rec.cantidad;
        ws.getCell(r, 5).value = fila.rec.pu;
        ws.getCell(r, 6).value = f(`+E${r}*D${r}`, fila.rec.cantidad * fila.rec.pu);
      }
      if (fila.aj) {
        ws.getCell(r, 7).value = fila.aj.um;
        ws.getCell(r, 8).value = fila.aj.cantidad;
        ws.getCell(r, 9).value = fila.aj.pu;
        ws.getCell(r, 10).value = f(`+I${r}*H${r}`, fila.aj.cantidad * fila.aj.pu);
      }
      ws.getCell(r, 11).value = fila.obs[0] ?? null;
      ws.getCell(r, 12).value = fila.obs[1] ?? null;
    } else if (fila.aj) {
      ws.getCell(r, 3).value = fila.aj.um;
      ws.getCell(r, 4).value = fila.aj.cantidad;
      ws.getCell(r, 5).value = fila.aj.pu;
      ws.getCell(r, 6).value = f(`+E${r}*D${r}`, fila.aj.cantidad * fila.aj.pu);
      ws.getCell(r, 7).value = fila.obs.join(", ") || null;
      ws.getCell(r, 7).style = structuredClone(P.linea[10]) as ExcelJS.Style;
    }
    formatearLinea(ws, r, fila.descripcion);
    ultima = r;
    r++;
  }
  aplicar(ws, r, P.blanco);
  r++;

  // ---- Totales (fórmulas vivas con resultado en caché) ----
  const recDirecto = e.reclamacion.lineas.reduce((s, l) => s + l.cantidad * l.pu, 0);
  const ajDirecto = filas.reduce((s, x) => (x.tipo === "linea" && x.aj ? s + x.aj.cantidad * x.aj.pu : s), 0);
  const gg = e.reclamacion.ggPct;
  const ut = e.reclamacion.utilidadPct;
  const iva = e.reclamacion.ivaPct;
  const col = dosColumnas ? ["F", "J"] : ["F"];
  const valor = (esAj: boolean) => (dosColumnas && !esAj ? recDirecto : ajDirecto);
  const pctCol = (esAj: boolean) => (dosColumnas && esAj ? "G" : "C");
  const unificado = ut === 0;
  const neto = (aj: boolean) => valor(aj) * (1 + gg + ut);
  const uf = (aj: boolean) => (neto(aj) * (1 + iva)) / e.valorUF;
  const refs: Record<string, number> = {};
  let fila = r;
  const write = (
    key: string,
    etiqueta: string,
    estilo: number,
    fn: (esAj: boolean, L: string) => ExcelJS.CellValue,
    pct?: number,
  ) => {
    aplicar(ws, fila, P.total[estilo]);
    ws.getCell(fila, 2).value = etiqueta;
    refs[key] = fila;
    col.forEach((L, i) => {
      const esAj = dosColumnas ? i === 1 : true;
      ws.getCell(`${L}${fila}`).value = fn(esAj, L);
      if (pct != null) ws.getCell(`${pctCol(esAj)}${fila}`).value = pct;
    });
    fila++;
  };
  const filaUF = r + (unificado ? 11 : 12); // fila de "Indicador para FDP"
  write("dir", "Total directo ($)", 0, (aj, L) => f(`SUM(${L}${primera}:${L}${ultima})`, valor(aj)));
  write("gg", unificado ? "Gastos generales y utilidades ($)" : "Gastos generales ", 1, (aj, L) => f(`+${L}${refs.dir}*${pctCol(aj)}${refs.gg ?? fila}`, valor(aj) * gg), gg);
  if (!unificado) write("ut", "utilidades ($)", 1, (aj, L) => f(`+${L}${refs.dir}*${pctCol(aj)}${fila}`, valor(aj) * ut), ut);
  write("neto", "Total neto ($)", 2, (aj, L) =>
    f(unificado ? `+${L}${refs.gg}+${L}${refs.dir}` : `+${L}${refs.gg}+${L}${refs.dir}+${L}${refs.ut}`, neto(aj)),
  );
  write("iva", "IVA ($)", 3, (aj, L) => f(`+${L}${refs.neto}*${pctCol(aj)}${fila}`, neto(aj) * iva), iva);
  write("tot", "Total con IVA ($)", 4, (aj, L) => f(`+${L}${refs.iva}+${L}${refs.neto}`, neto(aj) * (1 + iva)));
  write("uf", "Equivalente en moneda de póliza (UF)", 5, (aj, L) => f(`+${L}${refs.tot}/C${filaUF}`, uf(aj)));
  const colAj = dosColumnas ? "J" : "F";
  aplicar(ws, fila, P.total[6]);
  ws.getCell(fila, 2).value = "Deducible contractual (UF)";
  ws.getCell(`${colAj}${fila}`).value = e.caso.poliza.deducibleUF;
  refs.ded = fila++;
  const bordeTotales = (fila0: number, lado: "top" | "bottom", estilo: ExcelJS.BorderStyle) => {
    for (let c = 2; c <= COLS; c++) {
      const cell = ws.getCell(fila0, c);
      cell.border = { ...cell.border, [lado]: { style: estilo } };
    }
  };
  bordeTotales(refs.dir, "top", "thin");
  write("ind", "Valor a indemnizar (UF)", 7, (aj, L) =>
    L === colAj ? f(`+${colAj}${refs.uf}-${colAj}${refs.ded}`, uf(true) - e.caso.poliza.deducibleUF) : null,
  );
  bordeTotales(fila - 1, "bottom", "double"); // doble línea bajo el valor a indemnizar
  fila++;
  const params: [string, ExcelJS.CellValue][] = [
    ["Moneda de Póliza ", "UF"],
    ["Fecha de Pérdida", { formula: "B4", result: new Date(`${e.caso.fechas.ocurrencia}T00:00:00Z`) }],
    ["Indicador para FDP", e.valorUF],
  ];
  params.forEach(([et, v], i) => {
    aplicar(ws, fila, P.param[i]);
    ws.getCell(fila, 2).value = et;
    ws.getCell(fila, 3).value = v;
    fila++;
  });
  if (fila - 1 !== filaUF) throw new Error(`Indicador FDP quedó en la fila ${fila - 1}, se esperaba ${filaUF}`);
  fila++;
  aplicar(ws, fila, P.obsTitulo);
  ws.getCell(fila, 2).value = "Observaciones";
  fila++;
  for (const L of LETRAS_OBS) {
    aplicar(ws, fila, P.obsLinea);
    ws.getCell(fila, 1).value = L;
    ws.getCell(fila, 2).value = LEYENDA[L];
    fila++;
  }
  ws.pageSetup.printArea = `A1:M${fila}`;
  agregarResumen(wb, { siniestro: e.caso.siniestro, reclamacion: e.reclamacion, filas, valorUF: e.valorUF, deducibleUF: e.caso.poliza.deducibleUF, dosColumnas, refs });

  // ---- Hojas auxiliares: se regeneran para no arrastrar datos de otro siniestro ----
  const sa = wb.getWorksheet("Siniestros anteriores");
  if (sa) {
    for (let i = 6; i <= Math.max(sa.rowCount, 8); i++) sa.getRow(i).values = [];
    if (e.siniestrosAnteriores.length) {
      e.siniestrosAnteriores.forEach((s, i) => {
        const row = sa.getRow(6 + i);
        row.getCell(2).value = `Siniestro Nº ${i + 1}`;
        row.getCell(3).value = s.numero;
        row.getCell(4).value = s.fecha;
        row.getCell(5).value = s.montoUF;
        row.getCell(6).value = s.causa;
        row.getCell(7).value = s.direccion;
        row.getCell(8).value = s.relacion;
      });
    } else sa.getRow(6).getCell(2).value = "Sin siniestros anteriores en la dirección del riesgo";
  }
  const viejaArea = wb.getWorksheet("Calculo de Area");
  if (viejaArea) wb.removeWorksheet(viejaArea.id);
  const pct = wb.getWorksheet("%");
  if (pct) wb.removeWorksheet(pct.id); // depreciación: no se aplica en pérdida parcial
  const area = wb.addWorksheet("Calculo de Area");
  area.addRow(["Recinto", "Alto", "Largo", "Ancho", "ML", "Muro bruto", "Muro neto (-30 % vanos)", "Paño", "Cielo", "Piso"]).font = { bold: true };
  e.recintos.forEach((rc, i) => {
    const n = i + 2;
    area.addRow([
      rc.nombre,
      rc.alto,
      rc.largo,
      rc.ancho,
      { formula: `2*C${n}+2*D${n}` },
      { formula: `2*(B${n}*C${n})+2*(B${n}*D${n})` },
      { formula: `F${n}*0.7` },
      { formula: `G${n}/4` },
      { formula: `C${n}*D${n}` },
      { formula: `C${n}*D${n}` },
    ]);
  });
  area.columns.forEach((cl) => (cl.width = 16));
  area.getColumn(1).width = 24;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
