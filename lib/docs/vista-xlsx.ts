import ExcelJS from "exceljs";
import { evaluarFormula, numeroACol } from "./formulas";

/** Vista editable de la planilla: valores tal como se ven, con las celdas de fórmula marcadas (no se editan: se recalculan). */
export type CeldaVista = { r: number; c: number; txt: string; raw: string; f?: string; b?: boolean; fondo?: string; al?: "left" | "center" | "right"; fecha?: boolean; aj?: boolean };
/** `altos`: alto de cada fila en px (0 = automático); `ajusteTexto`: las celdas parten el texto en varias líneas en vez de cortarlo. */
export type HojaVista = { nombre: string; filas: number; columnas: number; anchos: number[]; altos: number[]; ajusteTexto: boolean; combinadas: { r1: number; c1: number; r2: number; c2: number }[]; celdas: CeldaVista[] };
export type CambioCelda = { hoja: string; r: number; c: number; valor: string };
/** Formato de la planilla que el usuario ajusta para leerla mejor: anchos de columna y alto de fila en px de pantalla, y ajuste de texto por hoja. */
export type CambioFormato = {
  columnas?: { hoja: string; c: number; ancho: number }[];
  filas?: { hoja: string; r: number; alto: number }[];
  ajusteTexto?: { hoja: string; activo: boolean }[];
};

const PX_POR_ANCHO = 7; // un carácter de ancho de Excel ≈ 7 px
const PT_POR_PX = 0.75; // 96 ppp → 72 pt

const MAX_FILAS = 300;
const MAX_COLS = 30;

type Valor = ExcelJS.CellValue;
const esFormula = (v: Valor): v is ExcelJS.CellFormulaValue => !!v && typeof v === "object" && "formula" in v;
const resultadoDe = (v: Valor): unknown => (esFormula(v) ? v.result : v);

function textoRich(v: unknown): unknown {
  if (v && typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((x) => x.text).join("");
  if (v && typeof v === "object" && "text" in v && !(v instanceof Date)) return (v as { text: string }).text;
  return v;
}

const ceros = (fmt: string) => (/\.(0+)/.exec(fmt)?.[1].length ?? 0);

/** Formato de número equivalente al de Excel para los casos de esta planilla (decimales, miles, porcentaje y fechas). */
export function formatear(v: unknown, fmt: string | undefined): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleDateString("es-CL", { timeZone: "UTC" });
  if (typeof v === "number") {
    if (fmt?.includes("%")) return `${(v * 100).toLocaleString("es-CL", { minimumFractionDigits: ceros(fmt), maximumFractionDigits: ceros(fmt) })}%`;
    if (fmt && /0|#/.test(fmt)) return v.toLocaleString("es-CL", { minimumFractionDigits: ceros(fmt), maximumFractionDigits: Math.max(ceros(fmt), 0) });
    return Number.isInteger(v) ? String(v) : v.toLocaleString("es-CL", { maximumFractionDigits: 4 });
  }
  return String(v);
}

const argbAHex = (argb?: string) => (argb && /^[0-9A-F]{8}$/i.test(argb) && argb.slice(0, 2).toUpperCase() !== "00" ? `#${argb.slice(2)}` : undefined);

export async function cargarLibro(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}

export function libroAVista(wb: ExcelJS.Workbook): HojaVista[] {
  recalcular(wb); // la vista muestra todas las fórmulas calculadas aunque la planilla no traiga su valor guardado
  return wb.worksheets
    .filter((ws) => ws.state === "visible")
    .map((ws) => {
      let filas = 0;
      let columnas = 0;
      ws.eachRow((row, r) =>
        row.eachCell((cell, c) => {
          if (resultadoDe(cell.value) != null && resultadoDe(cell.value) !== "") {
            filas = Math.max(filas, r);
            columnas = Math.max(columnas, c);
          }
        }),
      );
      filas = Math.min(MAX_FILAS, filas);
      columnas = Math.min(MAX_COLS, columnas);
      const celdas: CeldaVista[] = [];
      for (let r = 1; r <= filas; r++)
        for (let c = 1; c <= columnas; c++) {
          const cell = ws.getCell(r, c);
          const v = cell.value;
          const res = textoRich(resultadoDe(v) ?? (esFormula(v) ? 0 : null));
          const fondo = cell.fill && cell.fill.type === "pattern" ? argbAHex((cell.fill.fgColor as { argb?: string } | undefined)?.argb) : undefined;
          if ((res == null || res === "") && !fondo) continue;
          const al = cell.alignment?.horizontal;
          celdas.push({
            r,
            c,
            txt: formatear(res, cell.numFmt),
            raw: res instanceof Date ? res.toISOString().slice(0, 10) : res == null ? "" : String(res),
            f: esFormula(v) ? v.formula : undefined,
            b: cell.font?.bold || undefined,
            fondo,
            al: al === "left" || al === "center" || al === "right" ? al : undefined,
            fecha: res instanceof Date || undefined,
            aj: cell.alignment?.wrapText || undefined,
          });
        }
      const merges = ((ws.model as { merges?: string[] }).merges ?? []).flatMap((m) => {
        const x = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
        if (!x) return [];
        const col = (s: string) => s.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        return [{ r1: Number(x[2]), c1: col(x[1]), r2: Number(x[4]), c2: col(x[3]) }];
      });
      return {
        nombre: ws.name,
        filas,
        columnas,
        anchos: Array.from({ length: columnas }, (_, i) => Math.round((ws.getColumn(i + 1).width ?? 9) * PX_POR_ANCHO)),
        altos: Array.from({ length: filas }, (_, i) => {
          const h = ws.getRow(i + 1).height;
          return h ? Math.round(h / PT_POR_PX) : 0;
        }),
        ajusteTexto: celdas.some((x) => x.aj),
        combinadas: merges.filter((m) => m.r1 <= filas && m.c1 <= columnas),
        celdas,
      };
    });
}

/** Texto escrito por el usuario → valor de celda: número (acepta coma decimal y puntos de miles), fecha dd-mm-aaaa / aaaa-mm-dd o texto. */
export function interpretarEntrada(t: string, eraFecha = false): string | number | Date | null {
  const s = t.trim();
  if (s === "") return null;
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) ?? (() => { const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s); return m ? [m[0], m[3], m[2], m[1]] : null; })();
  if (f && (eraFecha || /^\d{4}-/.test(s))) return new Date(Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3])));
  const n = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (/^-?\d+(\.\d+)?$/.test(n) && !/^0\d/.test(n)) return Number(n);
  return s;
}

/** Recalcula todas las fórmulas con los valores actuales (varias pasadas: una fórmula puede depender de otra). */
export function recalcular(wb: ExcelJS.Workbook): number {
  const formulas: { ws: ExcelJS.Worksheet; r: number; c: number; f: string }[] = [];
  for (const ws of wb.worksheets) ws.eachRow((row, r) => row.eachCell((cell, c) => { if (esFormula(cell.value)) formulas.push({ ws, r, c, f: cell.value.formula }); }));
  const leer = (hoja: string | null, c: number, r: number) => {
    const v = (hoja ? wb.getWorksheet(hoja) : undefined)?.getCell(r, c).value;
    return resultadoDe(v ?? null);
  };
  let cambios = 0;
  for (let pasada = 0; pasada < 6; pasada++) {
    let huboCambio = false;
    for (const { ws, r, c, f } of formulas) {
      const res = evaluarFormula(f, ws.name, (h, cc, rr) => leer(h ?? ws.name, cc, rr));
      if (res === null) continue;
      const cell = ws.getCell(r, c);
      const antes = resultadoDe(cell.value);
      // ExcelJS no conserva un resultado 0 (lo trata como vacío): un 0 calculado sobre una celda sin valor guardado no es un cambio.
      const igual =
        antes instanceof Date && res instanceof Date
          ? antes.getTime() === res.getTime()
          : typeof antes === "number" && typeof res === "number"
            ? Math.abs(antes - res) < 1e-9
            : (antes == null && res === 0) || antes === res;
      if (!igual) {
        cell.value = { formula: f, result: res as number } as ExcelJS.CellFormulaValue;
        huboCambio = true;
        cambios++;
      }
    }
    if (!huboCambio) break;
  }
  return cambios;
}

/** Anchos, altos y ajuste de texto que el usuario dejó en pantalla pasan al propio archivo (así se ve igual al descargarlo). */
export function aplicarFormato(wb: ExcelJS.Workbook, f: CambioFormato) {
  const hoja = (n: string) => {
    const ws = wb.getWorksheet(n);
    if (!ws) throw new Error(`La hoja «${n}» no existe.`);
    return ws;
  };
  for (const k of f.columnas ?? []) {
    if (k.c < 1 || k.c > MAX_COLS) throw new Error(`Columna fuera de rango: ${k.c}`);
    hoja(k.hoja).getColumn(k.c).width = Math.round((k.ancho / PX_POR_ANCHO) * 100) / 100;
  }
  for (const k of f.filas ?? []) {
    if (k.r < 1 || k.r > MAX_FILAS) throw new Error(`Fila fuera de rango: ${k.r}`);
    hoja(k.hoja).getRow(k.r).height = k.alto > 0 ? Math.round(k.alto * PT_POR_PX * 100) / 100 : (undefined as unknown as number);
  }
  for (const k of f.ajusteTexto ?? []) {
    const ws = hoja(k.hoja);
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (resultadoDe(cell.value) == null || resultadoDe(cell.value) === "") return;
        cell.alignment = { ...cell.alignment, wrapText: k.activo, vertical: cell.alignment?.vertical ?? "top" };
      }),
    );
  }
}

/** Aplica las celdas editadas (nunca las de fórmula), recalcula y devuelve el nuevo archivo. */
export async function aplicarCeldas(buf: Buffer, cambios: CambioCelda[], formato: CambioFormato = {}): Promise<{ buffer: Buffer; recalculadas: number }> {
  const wb = await cargarLibro(buf);
  for (const k of cambios) {
    const ws = wb.getWorksheet(k.hoja);
    if (!ws) throw new Error(`La hoja «${k.hoja}» no existe.`);
    if (k.r < 1 || k.c < 1 || k.r > MAX_FILAS || k.c > MAX_COLS) throw new Error(`Celda fuera de rango: ${numeroACol(k.c)}${k.r}`);
    const cell = ws.getCell(k.r, k.c);
    if (esFormula(cell.value)) throw new Error(`${k.hoja}!${numeroACol(k.c)}${k.r} es una fórmula: edita los valores de los que depende.`);
    cell.value = interpretarEntrada(k.valor, resultadoDe(cell.value) instanceof Date) as ExcelJS.CellValue;
  }
  aplicarFormato(wb, formato);
  const recalculadas = recalcular(wb);
  wb.calcProperties.fullCalcOnLoad = true;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), recalculadas };
}
