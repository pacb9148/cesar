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

export async function parsearPresupuestoXlsx(buf: Buffer): Promise<ResultadoPresupuesto> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const alertas: string[] = [];
  // Cabecera: fila que contiene UNIDAD, CANT y PREC.
  let hdr = 0;
  const col: Record<string, number> = {};
  ws.eachRow((row, r) => {
    if (hdr) return;
    const txt = row.values as unknown[];
    const joined = txt.map((x) => String(x ?? "").toUpperCase()).join("|");
    if (/UNIDAD/.test(joined) && /CANT/.test(joined) && /PREC/.test(joined)) {
      hdr = r;
      row.eachCell((c, i) => {
        const h = celdaTxt(c).toUpperCase();
        if (/PARTIDA|DESCRIP/.test(h)) col.desc = i;
        else if (/UNIDAD|U\/M/.test(h)) col.um = i;
        else if (/CANT/.test(h)) col.cant = i;
        else if (/PREC.*UNIT|P\.? ?UNIT/.test(h)) col.pu = i;
      });
    }
  });
  if (!hdr || !col.desc || !col.um || !col.cant || !col.pu) {
    return { reclamacion: { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0, utilidadPct: 0, ivaPct: IVA }, alertas: ["No se reconoció la tabla de partidas del Excel (faltan columnas PARTIDA/UNIDAD/CANT/PRECIO)."] };
  }
  const c = new Constructor();
  const decl = { directo: null as number | null, gg: null as number | null, util: null as number | null, iva: null as number | null };
  let subtotalNeto: number | null = null;
  ws.eachRow((row, r) => {
    if (r <= hdr) return;
    const desc = celdaTxt(row.getCell(col.desc));
    if (!desc) return;
    const um = unidadDe(celdaTxt(row.getCell(col.um)));
    const cant = celdaNum(row.getCell(col.cant));
    const pu = celdaNum(row.getCell(col.pu));
    if (um && cant != null && pu != null) c.linea(desc, um, cant, pu);
    else if (/^SUBTOTAL NETO/i.test(desc)) subtotalNeto = celdaNum(row.getCell(col.pu + 3)) ?? celdaNum(row.getCell(col.pu + 2));
    else if (/^(GGUU|GASTOS GENERALES)/i.test(desc)) decl.gg = celdaNum(row.getCell(col.pu + 3)) ?? celdaNum(row.getCell(col.pu + 2));
    else if (/^IVA/i.test(desc)) decl.iva = celdaNum(row.getCell(col.pu + 3)) ?? celdaNum(row.getCell(col.pu + 2));
    else if (!/^(COSTO TOTAL|SUBTOTAL|TOTAL)/i.test(desc)) c.seccion(desc);
  });
  decl.directo = subtotalNeto;
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
