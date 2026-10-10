import ExcelJS from "exceljs";
import { GG_UTILIDADES_UNIFICADO, IVA } from "../domain/constantes";
import type { LineaReclamacion, Reclamacion, Seccion, Unidad } from "../domain/tipos";

export type ResultadoPresupuesto = {
  reclamacion: Reclamacion;
  /** Problemas que impiden confiar en la lectura: el usuario debe revisarlos antes de ajustar. */
  alertas: string[];
};

const UNIDADES: Record<string, Unidad> = {
  m2: "m2", "m²": "m2", ml: "ml", gl: "gl", un: "un", und: "un", u: "un", m3: "m3", "m³": "m3", kg: "kg",
};
export const unidadDe = (s: string): Unidad | null => UNIDADES[s.trim().toLowerCase()] ?? null;

/** "$5.500" → 5500 · "9,52" → 9.52 · "1," → 1 · "11.701.639" → 11701639 */
export function numeroCL(s: string): number {
  const t = s.replace(/[$\s]/g, "").replace(/,$/, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t.replace(",", "."));
}

type Borrador = { secciones: Seccion[]; lineas: LineaReclamacion[] };

class Constructor {
  private b: Borrador = { secciones: [], lineas: [] };
  private n = 0; // sección actual
  private k = 0; // línea dentro de la sección
  private titulos = new Map<string, number>();

  seccion(titulo: string) {
    const base = titulo.replace(/\s+/g, " ").trim();
    const veces = (this.titulos.get(base.toLowerCase()) ?? 0) + 1;
    this.titulos.set(base.toLowerCase(), veces);
    this.n += 1;
    this.k = 0;
    this.b.secciones.push({ numero: `${this.n}.0`, titulo: veces > 1 ? `${base} (${veces})` : base });
  }
  linea(descripcion: string, um: Unidad, cantidad: number, pu: number) {
    if (this.n === 0) this.seccion("GENERAL");
    this.k += 1;
    const sec = this.b.secciones[this.b.secciones.length - 1];
    this.b.lineas.push({ item: `${this.n}.${this.k}`, recinto: sec.titulo, descripcion: descripcion.replace(/\s+/g, " ").trim(), um, cantidad, pu });
  }
  get lineas() {
    return this.b.lineas;
  }
  resultado(): Borrador {
    return this.b;
  }
}

function cerrar(
  b: Borrador,
  decl: { directo: number | null; gg: number | null; util: number | null; iva: number | null },
  alertasExtra: string[] = [],
): ResultadoPresupuesto {
  const alertas = [...alertasExtra];
  const suma = b.lineas.reduce((s, l) => s + l.cantidad * l.pu, 0);
  if (b.lineas.length === 0) alertas.push("No se pudo leer ninguna partida del presupuesto.");
  if (decl.directo != null && Math.abs(suma - decl.directo) > Math.max(5, decl.directo * 0.0005))
    alertas.push(`La suma de las partidas ($${Math.round(suma).toLocaleString("es-CL")}) no coincide con el costo directo declarado ($${Math.round(decl.directo).toLocaleString("es-CL")}).`);
  const base = decl.directo ?? suma;
  let ggPct = decl.gg != null && base ? decl.gg / base : GG_UTILIDADES_UNIFICADO;
  let utilPct = decl.util != null && base ? decl.util / base : 0;
  // Redondeo a porcentajes enteros: los presupuestos declaran 25 %, 12 % + 10 %.
  ggPct = Math.round(ggPct * 100) / 100;
  utilPct = Math.round(utilPct * 100) / 100;
  return {
    reclamacion: {
      secciones: b.secciones,
      lineas: b.lineas,
      totalDirectoDeclarado: decl.directo,
      ggPct,
      utilidadPct: utilPct,
      ivaPct: decl.iva != null && base ? Math.round((decl.iva / (base * (1 + ggPct + utilPct))) * 100) / 100 : IVA,
    },
    alertas,
  };
}

/* ------------------------------ XLSX ------------------------------ */

const celdaTxt = (c: ExcelJS.Cell): string => {
  const v = c.value;
  if (v && typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "");
  return v == null ? "" : String(v).trim();
};
const celdaNum = (c: ExcelJS.Cell): number | null => {
  const v = c.value;
  const x = v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v;
  return typeof x === "number" ? x : null;
};

type Columnas = { desc: number; um: number; cant: number; pu: number; total: number | null };

/** Cada contratista nombra distinto sus columnas («Costo uni», «P. Unit.», «Valor unitario»…): se reconoce por el sentido, no por una palabra fija. */
const ES_DESC = /PARTIDA|DESCRIP|DETALLE|ITEM|[IÍ]TEM|TRABAJO|ACTIVIDAD|CONCEPTO/;
const ES_UM = /^(UNIDAD|UND|UN|U\/M|UM|U\.M\.?|MEDIDA)\b/;
const ES_CANT = /CANT/;
const ES_PU = /PREC|COSTO\s*UNI|VALOR\s*UNI|V\.?\s*UNIT|P\.?\s*UNIT|C\.?\s*UNIT|UNITARIO/;
const ES_TOTAL = /TOTAL|SUBTOTAL|IMPORTE|MONTO/;

/** Busca la fila de títulos de la tabla de partidas en una hoja; null si no parece un presupuesto. */
function buscarCabecera(ws: ExcelJS.Worksheet): { fila: number; col: Columnas } | null {
  let hallada: { fila: number; col: Columnas } | null = null;
  ws.eachRow((row, r) => {
    if (hallada || r > 60) return;
    const col: Partial<Columnas> = {};
    row.eachCell((c, i) => {
      const h = celdaTxt(c).toUpperCase().replace(/\s+/g, " ").trim();
      if (!h) return;
      if (ES_CANT.test(h)) col.cant ??= i;
      else if (ES_PU.test(h)) col.pu ??= i;
      else if (ES_UM.test(h)) col.um ??= i;
      else if (ES_TOTAL.test(h)) col.total ??= i;
      else if (ES_DESC.test(h)) col.desc ??= i;
    });
    if (col.um && col.cant && col.pu) hallada = { fila: r, col: { desc: col.desc ?? Math.max(1, col.um - 1), um: col.um, cant: col.cant, pu: col.pu, total: col.total ?? null } };
  });
  return hallada;
}

/** Valor numérico de una fila de resumen (costo directo, GG, IVA…): la columna de totales y, si no, el último importe de la fila. */
function importeDeResumen(row: ExcelJS.Row, col: Columnas): number | null {
  if (col.total) {
    const v = celdaNum(row.getCell(col.total));
    if (v != null) return v;
  }
  let ultimo: number | null = null;
  row.eachCell((c, i) => {
    if (i <= col.pu) return;
    const v = celdaNum(c);
    if (v != null && Math.abs(v) >= 1) ultimo = v;
  });
  return ultimo;
}

const tieneNumeros = (row: ExcelJS.Row, desde: number): boolean => {
  let hay = false;
  row.eachCell((c, i) => {
    if (i > desde && celdaNum(c) != null) hay = true;
  });
  return hay;
};

export async function parsearPresupuestoXlsx(buf: Buffer): Promise<ResultadoPresupuesto> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const alertas: string[] = [];
  // Se prueba cada hoja: el presupuesto no siempre está en la primera.
  let ws: ExcelJS.Worksheet | null = null;
  let cab: { fila: number; col: Columnas } | null = null;
  for (const h of wb.worksheets) {
    const c = buscarCabecera(h);
    if (c) {
      ws = h;
      cab = c;
      break;
    }
  }
  if (!ws || !cab) {
    return { reclamacion: { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0, utilidadPct: 0, ivaPct: IVA }, alertas: ["No se reconoció la tabla de partidas del Excel (faltan las columnas de unidad, cantidad y precio unitario)."] };
  }
  const { fila: hdr, col } = cab;
  const c = new Constructor();
  const decl = { directo: null as number | null, gg: null as number | null, util: null as number | null, iva: null as number | null };
  ws.eachRow((row, r) => {
    if (r <= hdr) return;
    const desc = celdaTxt(row.getCell(col.desc));
    if (!desc) return;
    const um = unidadDe(celdaTxt(row.getCell(col.um)));
    const cant = celdaNum(row.getCell(col.cant));
    let pu = celdaNum(row.getCell(col.pu));
    // Sin precio unitario pero con el total de la línea: se deduce de ahí (el total es lo que cobra el contratista).
    if (pu == null && cant && col.total) {
      const t = celdaNum(row.getCell(col.total));
      if (t != null) pu = t / cant;
    }
    if (um && cant != null && pu != null) return void c.linea(desc, um, cant, pu);
    if (/^(SUB\s?TOTAL NETO|COSTO DIRECTO|TOTAL DIRECTO|TOTAL COSTO DIRECTO|NETO\b)/i.test(desc)) decl.directo = importeDeResumen(row, col);
    else if (/^(GGUU|GG\s?(Y|&)\s?UU|GASTOS GENERALES|GG\b)/i.test(desc)) decl.gg = importeDeResumen(row, col);
    else if (/^UTILIDAD/i.test(desc)) decl.util = importeDeResumen(row, col);
    else if (/^I\.?V\.?A\b/i.test(desc)) decl.iva = importeDeResumen(row, col);
    // Resúmenes y notas (valor obra, total, UF…) no son recintos; un recinto puede traer medidas (largo, ancho…) pero nunca importes en las columnas de unidad, cantidad o precio.
    else if (/^(COSTO TOTAL|SUB\s?TOTAL|TOTAL|VALOR\b|PRECIO FINAL|OBSERVACION|NOTA)/i.test(desc) || tieneNumeros(row, Math.min(col.um, col.cant, col.pu) - 1)) return;
    else c.seccion(desc);
  });
  const r = cerrar(c.resultado(), decl, alertas);
  // En estos libros el costo directo no siempre trae valor en caché: si no hay, se acepta la suma.
  if (decl.directo == null) r.reclamacion.totalDirectoDeclarado = null;
  return r;
}

/* ------------------------------ PDF ------------------------------ */

const LINEA_PARTIDA = /^(?:\d+\s+)?(.+?)\s+(m²|m2|m3|m³|ml|gl|un|und|kg)\s+([\d.,]+)\s+\$?\s*([\d.]+)\s+\$?\s*([\d.]+)\s*$/i;
/** Algunos PDF pegan la unidad al texto anterior ("…daño menorM2 20,00 $11.000 $220.000"). */
const LINEA_PEGADA = /^(?:\d+\s+)?(.+?[a-záéíóúñ.,)])(M2|M²|ML|GL|UN)\s+([\d.,]+)\s+\$?\s*([\d.]+)\s+\$?\s*([\d.]+)\s*$/;
const MONTO = /\$?\s*([\d]{1,3}(?:\.\d{3})+|\d+)\s*$/;

export function parsearPresupuestoPdf(paginas: string[]): ResultadoPresupuesto {
  const lineas = paginas
    .join("\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const c = new Constructor();
  const decl = { directo: null as number | null, gg: null as number | null, util: null as number | null, iva: null as number | null };
  const alertas: string[] = [];
  let ggUnico = false;

  for (const l of lineas) {
    const m = LINEA_PARTIDA.exec(l) ?? LINEA_PEGADA.exec(l);
    if (m) {
      const um = unidadDe(m[2])!;
      const cant = numeroCL(m[3]);
      const pu = numeroCL(m[4]);
      const total = numeroCL(m[5]);
      if (Math.abs(cant * pu - total) > Math.max(2, total * 0.002))
        alertas.push(`Partida con total inconsistente: "${l}" (${cant} × ${pu} ≠ ${total}).`);
      c.linea(m[1], um, cant, pu);
      continue;
    }
    if (/^(sub\s?total|subtotal)\b/i.test(l)) continue;
    if (/^(cliente|direcci[óo]n|mail|tel[ée]fono|rut|profesi[óo]n|contratista|item\b|n[°º] partida|identificaci[óo]n|presupuesto|siniestro)/i.test(l)) continue;
    const monto = MONTO.exec(l);
    if (/^costo directo/i.test(l) && monto) decl.directo = numeroCL(monto[1]);
    else if (/^gastos generales/i.test(l) && monto) decl.gg = numeroCL(monto[1]);
    else if (/^utilidad/i.test(l) && monto) decl.util = numeroCL(monto[1]);
    else if (/^iva/i.test(l) && monto) decl.iva = numeroCL(monto[1]);
    else if (/^(total neto|total presupuesto|total\b|subtotal neto|resumen general|condiciones comerciales|forma de pago|estados de pago|plazo de entrega|validez)/i.test(l)) {
      if (/^resumen general/i.test(l)) ggUnico = false;
      continue;
    } else if (/[A-Za-zÁÉÍÓÚáéíóú]/.test(l) && !/\$/.test(l) && l.length < 80 && !/^\d+\s/.test(l)) {
      // Encabezado de recinto, p. ej. "Dormitorio 1 3,4x2,8x2,4" o "COBERTIZO · 17,82 m²".
      c.seccion(l.replace(/\s*\d+(?:,\d+)?x\d+(?:,\d+)?x\d+(?:,\d+)?\s*$/i, ""));
    } else if (/\d/.test(l) && /(m2|m²|ml|gl)/i.test(l)) {
      alertas.push(`Línea no interpretada (revisar a mano): "${l}"`);
    }
  }
  void ggUnico;
  // Presupuestos con "Costo directo (suma de recintos) 8.060.090 / Gastos Generales (12%) 967.211 / Utilidades (10%) 806.009"
  const mDirecto = lineas.find((l) => /^costo directo/i.test(l));
  if (mDirecto && decl.directo == null) decl.directo = numeroCL(MONTO.exec(mDirecto)?.[1] ?? "0");
  return cerrar(c.resultado(), decl, alertas);
}
