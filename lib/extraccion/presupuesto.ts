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
  // La sección se abre al llegar su primera partida: un título suelto (portada, firma) nunca queda como sección vacía.
  private pendiente: string | null = null;

  seccion(titulo: string) {
    this.pendiente = titulo.replace(/\s+/g, " ").trim();
  }
  /** El título del capítulo seguía en la línea siguiente («…cielo Living - comedor,» / «dormitorio N°1 y N°2»). */
  ampliarTitulo(texto: string) {
    if (this.pendiente) this.pendiente = `${this.pendiente} ${texto}`.replace(/\s+/g, " ").trim();
  }
  private abrir(base: string) {
    const veces = (this.titulos.get(base.toLowerCase()) ?? 0) + 1;
    this.titulos.set(base.toLowerCase(), veces);
    this.n += 1;
    this.k = 0;
    this.b.secciones.push({ numero: `${this.n}.0`, titulo: veces > 1 ? `${base} (${veces})` : base });
  }
  linea(descripcion: string, um: Unidad, cantidad: number, pu: number) {
    if (this.pendiente !== null) {
      this.abrir(this.pendiente);
      this.pendiente = null;
    } else if (this.n === 0) this.abrir("GENERAL");
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
const ES_DESC = /PARTIDA|DESCRIP|DETALLE|TRABAJO|ACTIVIDAD|CONCEPTO/;
/** «Ítem» solo sirve como descripción si no hay otra columna de texto: casi siempre es el número de la partida. */
const ES_ITEM = /^(ITEM|[IÍ]TEM)\b/;
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
    let item: number | undefined;
    row.eachCell((c, i) => {
      const h = celdaTxt(c).toUpperCase().replace(/\s+/g, " ").trim();
      if (!h) return;
      if (ES_CANT.test(h)) col.cant ??= i;
      else if (ES_PU.test(h)) col.pu ??= i;
      else if (ES_UM.test(h)) col.um ??= i;
      else if (ES_TOTAL.test(h)) col.total ??= i;
      else if (ES_DESC.test(h)) col.desc ??= i;
      else if (ES_ITEM.test(h)) item ??= i;
    });
    if (col.um && col.cant && col.pu) hallada = { fila: r, col: { desc: col.desc ?? item ?? Math.max(1, col.um - 1), um: col.um, cant: col.cant, pu: col.pu, total: col.total ?? null } };
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
    // Unidades de compra (uni, galón, caja…) también valen: si no, la fila se perdía en silencio como si fuera un título.
    const unidad = unidadPdf(celdaTxt(row.getCell(col.um)));
    const um = unidad?.um ?? null;
    const cant = celdaNum(row.getCell(col.cant));
    let pu = celdaNum(row.getCell(col.pu));
    // Sin precio unitario pero con el total de la línea: se deduce de ahí (el total es lo que cobra el contratista).
    if (pu == null && cant && col.total) {
      const t = celdaNum(row.getCell(col.total));
      if (t != null) pu = t / cant;
    }
    if (um && cant != null && pu != null) return void c.linea(unidad?.nota ? `${desc} (${unidad.nota})` : desc, um, cant, pu);
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
/** Fila de la tabla con cualquier unidad: «[ítem] descripción unidad cantidad P.U. total» (la unidad es la última palabra antes de los tres números). */
const LINEA_GENERAL = /^(?:\d+(?:\.\d+)*[.)]?\s+)?(.+?)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ²³][A-Za-zÁÉÍÓÚÑáéíóúñ²³0-9./]{0,9})\s+(\d[\d.,]*)\s+\$?\s*(\d[\d.,]*)\s+\$?\s*(\d[\d.,]*)\s*$/;
const MONTO = /\$?\s*([\d]{1,3}(?:\.\d{3})+|\d+)\s*$/;
/** «4.1 Planchas…»: ítem numerado dentro de un capítulo. */
const NUM_ITEM = /^(\d+(?:\.\d+)+)[.)]?\s+/;
/** «1 Desarme cubierta»: capítulo numerado (el nombre empieza con letra). */
const NUM_CAPITULO = /^(\d+)[.)]?\s+(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/;
/** Fila de títulos de la tabla: «Ítem Partida Unidad Cantidad P.U. Total». */
const CABECERA_TABLA = /^(?:[IÍ]tem\b.*\b(?:partida|descripci[oó]n|detalle)\b|.*\bunidad\b.*\bcantidad\b)/i;
const RESUMEN = /^(costo directo|gastos generales|utilidades?|iva\b|total|subtotal|sub total|resumen general|condiciones comerciales|forma de pago|estados de pago|plazo de entrega|validez)/i;
/** Datos de quien recibe o emite el presupuesto: nunca son partidas ni secciones. */
const DATOS_DE_PORTADA = /^(sr\.?|sra\.?|se[ñn]or(?:es|a)?|don|do[ñn]a|fono|fecha|tel[ée]fono|celular|cel\.?|e-?mail|correo|direcci[oó]n|atenci[oó]n|ref\.?|referencia|rut|cliente|obra|proyecto|presupuesto|cotizaci[oó]n|propuesta|contratista|profesi[oó]n|siniestro|mail|item\b|n[°º] partida|identificaci[oó]n)/i;

/**
 * Unidades que usan los presupuestos y su equivalente en el sistema. Las unidades de compra (caja, galón, saco…) se leen como «un»; la palabra original
 * se deja anotada en la descripción para no perder lo que escribió el contratista.
 */
const UNIDADES_PDF: Record<string, { um: Unidad; nota?: string }> = {
  uni: { um: "un" }, unid: { um: "un" }, unidad: { um: "un" }, unidades: { um: "un" }, pza: { um: "un" }, pz: { um: "un" }, pieza: { um: "un" }, piezas: { um: "un" },
  caja: { um: "un", nota: "caja" }, cajas: { um: "un", nota: "caja" }, galon: { um: "un", nota: "galón" }, galón: { um: "un", nota: "galón" }, galones: { um: "un", nota: "galón" }, gal: { um: "un", nota: "galón" },
  saco: { um: "un", nota: "saco" }, sacos: { um: "un", nota: "saco" }, rollo: { um: "un", nota: "rollo" }, rollos: { um: "un", nota: "rollo" }, tarro: { um: "un", nota: "tarro" }, tarros: { um: "un", nota: "tarro" },
  plancha: { um: "un", nota: "plancha" }, planchas: { um: "un", nota: "plancha" }, juego: { um: "un", nota: "juego" }, jgo: { um: "un", nota: "juego" }, par: { um: "un", nota: "par" },
  lt: { um: "un", nota: "litro" }, lts: { um: "un", nota: "litro" }, litro: { um: "un", nota: "litro" }, litros: { um: "un", nota: "litro" },
  m: { um: "ml" }, mt: { um: "ml" }, mts: { um: "ml" }, metro: { um: "ml" }, metros: { um: "ml" }, mt2: { um: "m2" }, mts2: { um: "m2" },
  global: { um: "gl" }, glob: { um: "gl" }, kgs: { um: "kg" },
  hr: { um: "gl", nota: "hora" }, hrs: { um: "gl", nota: "hora" }, hora: { um: "gl", nota: "hora" }, horas: { um: "gl", nota: "hora" }, dia: { um: "gl", nota: "día" }, días: { um: "gl", nota: "día" }, dias: { um: "gl", nota: "día" }, jornada: { um: "gl", nota: "jornada" },
};
function unidadPdf(token: string): { um: Unidad; nota?: string } | null {
  const t = token.trim().toLowerCase().replace(/\.$/, "");
  const base = unidadDe(t);
  return base ? { um: base } : (UNIDADES_PDF[t] ?? null);
}

const coherente = (cant: number, pu: number, total: number) => Math.abs(cant * pu - total) <= Math.max(2, total * 0.002);

/**
 * Presupuesto en PDF. La estructura es capítulo → elementos: cada capítulo («1 Desarme cubierta», «Dormitorio 1») es una sección y TODA fila con
 * cantidad, precio y total es una línea editable de esa sección, sea cual sea su unidad. Lo que va antes de la tabla (destinatario, dirección, fono,
 * fecha) y lo que va después de los totales (firma) no son partidas ni secciones.
 */
export function parsearPresupuestoPdf(paginas: string[]): ResultadoPresupuesto {
  const todas = paginas
    .join("\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  // La tabla empieza tras su fila de títulos o, si no la hay, en el primer ítem numerado; antes de eso solo hay datos de portada.
  const iCabecera = todas.findIndex((l) => CABECERA_TABLA.test(l));
  const iNumerado = todas.findIndex((l) => NUM_ITEM.test(l));
  const inicio = iCabecera >= 0 ? iCabecera + 1 : iNumerado >= 0 ? Math.max(0, iNumerado - 1) : 0;
  const lineas = todas.slice(inicio);
  const numerado = lineas.filter((l) => NUM_ITEM.test(l)).length >= 2;

  const c = new Constructor();
  const decl = { directo: null as number | null, gg: null as number | null, util: null as number | null, iva: null as number | null };
  const alertas: string[] = [];
  let cerrada = false; // ya pasaron los totales: lo que sigue (firma, nombre del ingeniero) no es presupuesto
  let continuaTitulo = false; // el título del capítulo anterior quedó a medias («…cielo Living - comedor,») y sigue en la línea siguiente
  let fragmento: string | null = null; // primera mitad de un título cuyo número y resto vienen en la línea siguiente («…comedor,» / «4 dormitorio N°1 y N°2»)
  let itemPartido: string | null = null; // «4.2 Perfiles metálicos, fijaciones y» sin importes: la descripción sigue en la fila siguiente

  for (let i = 0; i < lineas.length; i++) {
    const siguiente = lineas[i + 1] ?? "";
    let l = lineas[i];
    if (itemPartido) {
      l = `${itemPartido} ${l}`;
      itemPartido = null;
    }
    const monto = MONTO.exec(l);
    if (RESUMEN.test(l)) {
      if (/^costo directo/i.test(l) && monto) decl.directo = numeroCL(monto[1]);
      else if (/^gastos generales/i.test(l) && monto) decl.gg = numeroCL(monto[1]);
      else if (/^utilidad/i.test(l) && monto) decl.util = numeroCL(monto[1]);
      else if (/^iva\b/i.test(l) && monto) decl.iva = numeroCL(monto[1]);
      if (/^(costo directo|gastos generales|utilidades?|iva\b|total\b|subtotal neto)/i.test(l) && c.lineas.length > 0) cerrada = true;
      continue;
    }
    if (cerrada) continue;

    const m = LINEA_PARTIDA.exec(l) ?? LINEA_PEGADA.exec(l);
    if (m) {
      const um = unidadDe(m[2])!;
      const cant = numeroCL(m[3]);
      const pu = numeroCL(m[4]);
      const total = numeroCL(m[5]);
      if (!coherente(cant, pu, total)) alertas.push(`Partida con total inconsistente: "${l}" (${cant} × ${pu} ≠ ${total}).`);
      c.linea(m[1].replace(NUM_ITEM, ""), um, cant, pu);
      continuaTitulo = false;
      continue;
    }
    const g = LINEA_GENERAL.exec(l);
    if (g) {
      const cant = numeroCL(g[3]);
      const pu = numeroCL(g[4]);
      const total = numeroCL(g[5]);
      const u = unidadPdf(g[2]);
      // Con una unidad desconocida solo es partida si la aritmética cuadra: así no se confunden direcciones o textos con números.
      if (u || coherente(cant, pu, total)) {
        if (!coherente(cant, pu, total)) alertas.push(`Partida con total inconsistente: "${l}" (${cant} × ${pu} ≠ ${total}).`);
        const nota = u ? u.nota : g[2];
        c.linea(`${g[1].replace(NUM_ITEM, "")}${nota ? ` (${nota})` : ""}`, u?.um ?? "un", cant, pu);
        continuaTitulo = false;
        continue;
      }
    }
    if (/^\d+$/.test(l)) continue; // número de capítulo suelto (celda combinada)
    if (DATOS_DE_PORTADA.test(l)) continue;

    const cap = NUM_CAPITULO.exec(l);
    const sinImportes = (t: string) => !/\$/.test(t) && !/(?:\d[\d.,]*\s+){2,}\d/.test(t);
    // Ítem numerado sin importes: la descripción sigue en la fila de abajo (texto largo que se partió en dos líneas).
    if (NUM_ITEM.test(l) && sinImportes(l) && LINEA_GENERAL.test(siguiente) && !NUM_ITEM.test(siguiente)) {
      itemPartido = l;
      continue;
    }
    if (cap && sinImportes(l) && !NUM_ITEM.test(l)) {
      const resto = l.slice(cap[0].length);
      c.seccion(fragmento ? `${fragmento} ${resto}` : resto);
      fragmento = null;
      continuaTitulo = /[,\-–]\s*$|\s(?:y|e|de)\s*$/i.test(l);
      continue;
    }
    if (/[A-Za-zÁÉÍÓÚáéíóú]/.test(l) && !/\$/.test(l) && l.length < 80 && !/^\d+\s/.test(l)) {
      if (numerado) {
        // En un presupuesto numerado solo cuenta lo que forma el título de un capítulo; lo demás no abre secciones.
        if (continuaTitulo || /^[a-záéíóúñ]/.test(l)) {
          c.ampliarTitulo(l);
          continuaTitulo = /[,\-–]\s*$/.test(l);
        } else if (NUM_CAPITULO.test(siguiente) && sinImportes(siguiente) && !NUM_ITEM.test(siguiente)) {
          fragmento = l; // el número del capítulo y el resto del título vienen en la línea siguiente
        } else if (NUM_ITEM.test(siguiente)) {
          c.seccion(l); // título sin número seguido de sus ítems
        }
        continue;
      }
      // Encabezado de recinto, p. ej. "Dormitorio 1 3,4x2,8x2,4" o "COBERTIZO · 17,82 m²".
      c.seccion(l.replace(/\s*\d+(?:,\d+)?x\d+(?:,\d+)?x\d+(?:,\d+)?\s*$/i, ""));
    } else if (/\d/.test(l) && (NUM_ITEM.test(l) || /(m2|m²|ml|gl)/i.test(l))) {
      alertas.push(`Línea no interpretada (revisar a mano): "${l}"`);
    }
  }
  // Presupuestos con "Costo directo (suma de recintos) 8.060.090 / Gastos Generales (12%) 967.211 / Utilidades (10%) 806.009"
  const mDirecto = todas.find((l) => /^costo directo/i.test(l));
  if (mDirecto && decl.directo == null) decl.directo = numeroCL(MONTO.exec(mDirecto)?.[1] ?? "0");
  return cerrar(c.resultado(), decl, alertas);
}

/** Presupuesto ya estructurado (lo entrega la lectura con IA de una imagen, un PDF escaneado o un Word): se arma igual que los demás formatos. */
export type PresupuestoEstructurado = {
  secciones: { titulo: string; partidas: { descripcion: string; um: string; cantidad: number; pu: number }[] }[];
  costoDirecto: number | null;
  gastosGenerales: number | null;
  utilidad: number | null;
  iva: number | null;
};

export function presupuestoDeEstructura(e: PresupuestoEstructurado): ResultadoPresupuesto {
  const c = new Constructor();
  const alertas: string[] = [];
  for (const s of e.secciones) {
    c.seccion(s.titulo || "GENERAL");
    for (const p of s.partidas) {
      const um = unidadDe(p.um);
      if (!um) alertas.push(`Partida con unidad desconocida «${p.um}»: «${p.descripcion}» se tomó como global (gl); revísala.`);
      c.linea(p.descripcion, um ?? "gl", p.cantidad, p.pu);
    }
  }
  return cerrar(c.resultado(), { directo: e.costoDirecto, gg: e.gastosGenerales, util: e.utilidad, iva: e.iva }, alertas);
}
