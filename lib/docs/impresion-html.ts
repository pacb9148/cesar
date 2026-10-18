import type { HojaVista } from "./vista-xlsx";
import { colorSobre } from "./contraste";

export type Orientacion = "auto" | "horizontal" | "vertical";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NUMERO = /^-?[\d.,%]+$/;

// Área imprimible de una hoja A4 con márgenes de 10 mm, en px de pantalla (96 ppp).
const ANCHO_HORIZONTAL = 1047;
const ANCHO_VERTICAL = 718;

// Columnas con textos cortos (u/m, cantidad, precio, total, fechas): su ancho sale del contenido y no del de la plantilla, para que ni sobre ni falte espacio.
const MAX_CORTA = 16;
const PX_CARACTER = 6.4;
const PX_NEGRITA = 7;
const RELLENO = 14;
const ANCHO_MINIMO = 30;
const FONDO_TITULOS = "#e7e7e7";

function anchoDeContenido(h: HojaVista, col: number): number | null {
  const combinadas = new Set(h.combinadas.filter((m) => m.c2 > m.c1).map((m) => `${m.r1},${m.c1}`));
  const textos = h.celdas.filter((x) => x.c === col && x.txt.trim() !== "" && !combinadas.has(`${x.r},${x.c}`));
  if (textos.length === 0) return null;
  const mayor = Math.max(...textos.flatMap((x) => x.txt.split("\n").map((l) => l.trim().length)));
  if (mayor > MAX_CORTA) return null;
  const px = Math.max(...textos.flatMap((x) => x.txt.split("\n").map((l) => l.trim().length * (x.b ? PX_NEGRITA : PX_CARACTER))));
  return Math.ceil(Math.max(ANCHO_MINIMO, px + RELLENO));
}

/**
 * Vista de impresión de una hoja del Excel: solo el área con contenido, escalada para caber a lo ancho de una hoja A4 (horizontal si es ancha), con
 * los encabezados de la tabla repetidos en cada página y sin partir una fila entre dos páginas. Devuelve un documento HTML completo (para un iframe o una ventana).
 */
export function hojaAHtml(h: HojaVista, opciones: { orientacion?: Orientacion } = {}): string {
  const con = h.celdas.filter((c) => c.txt.trim() !== "");
  const ultimaFila = con.reduce((m, c) => Math.max(m, c.r), 1);
  const ultimaCol = con.reduce((m, c) => Math.max(m, c.c), 1);
  const porContenido = Array.from({ length: ultimaCol }, (_, i) => anchoDeContenido(h, i + 1));
  const anchos = porContenido.map((a, i) => a ?? h.anchos[i] ?? 64);
  const total = anchos.reduce((a, b) => a + b, 0);
  const orientacion = opciones.orientacion && opciones.orientacion !== "auto" ? opciones.orientacion : total > ANCHO_VERTICAL ? "horizontal" : "vertical";
  const disponible = orientacion === "horizontal" ? ANCHO_HORIZONTAL : ANCHO_VERTICAL;
  const escala = Math.min(1, disponible / total);

  const celdas = new Map(h.celdas.map((c) => [`${c.r},${c.c}`, c]));
  const origen = new Map(h.combinadas.map((m) => [`${m.r1},${m.c1}`, m]));
  const cubiertas = new Set<string>();
  for (const m of h.combinadas) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) cubiertas.add(`${r},${c}`);

  // En la planilla del ajuste los títulos de la tabla (filas 10 y 11) se repiten en cada página.
  const repetir = h.nombre === "EDIFICIO" ? [10, 11] : [];
  const plano = repetir.length > 0;
  const fila = (r: number) => {
    const tds: string[] = [];
    for (let c = 1; c <= ultimaCol; c++) {
      const k = `${r},${c}`;
      if (cubiertas.has(k)) continue;
      const x = celdas.get(k);
      const m = origen.get(k);
      const span = m ? ` colspan="${Math.min(m.c2, ultimaCol) - m.c1 + 1}" rowspan="${m.r2 - m.r1 + 1}"` : "";
      const al = x?.al ?? (x && NUMERO.test(x.txt) ? "right" : "left");
      const corta = porContenido[c - 1] !== null;
      // Planilla del ajuste: sin rejilla ni resaltado de filas; solo los títulos de la tabla llevan un fondo gris suave.
      const fondo = plano ? (repetir.includes(r) ? FONDO_TITULOS : undefined) : x?.fondo;
      const estilo = [corta ? "white-space:nowrap" : "", fondo ? `background:${fondo}` : "", `color:${colorSobre(fondo)}`, x?.b ? "font-weight:700" : "", `text-align:${al}`].filter(Boolean).join(";");
      tds.push(`<td${span} style="${estilo}">${x ? esc(x.txt) : ""}</td>`);
    }
    const alto = h.altos[r - 1];
    return `<tr${alto ? ` style="height:${alto}px"` : ""}>${tds.join("")}</tr>`;
  };

  const filas = Array.from({ length: ultimaFila }, (_, i) => i + 1);
  // Las filas anteriores a los títulos van antes (datos del siniestro); los títulos repetidos, en el thead; el resto, después.
  const antes = repetir.length ? filas.filter((r) => r < repetir[0]).map(fila) : [];
  const cabecera = filas.filter((r) => repetir.includes(r)).map(fila);
  const cuerpo = filas.filter((r) => !repetir.length || r > repetir[repetir.length - 1]).map(fila);

  // Los datos del siniestro van en su propia tabla, encima de los títulos (si fueran la misma tabla, el thead los pasaría por delante).
  const colgroup = `<colgroup>${anchos.map((w) => `<col style="width:${w}px">`).join("")}</colgroup>`;
  const tabla = (contenido: string) => (contenido.replace(/<\/?(tbody|thead)>/g, "") === "" ? "" : `<table>${colgroup}${contenido}</table>`);

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(h.nombre)}</title><style>
    @page { size: A4 ${orientacion === "horizontal" ? "landscape" : "portrait"}; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #6b7280; font: 11px Arial, Helvetica, sans-serif; color: #000; }
    .hoja { background: #fff; width: ${Math.ceil(total * escala)}px; margin: 16px auto; padding: 0; box-shadow: 0 1px 6px rgba(0,0,0,.4); }
    table { border-collapse: collapse; table-layout: fixed; width: ${total}px; zoom: ${escala}; }
    td { padding: ${plano ? "2px" : "1px"} 4px; ${plano ? "border: 0;" : "border: 1px solid #d4d4d8;"} overflow: hidden; white-space: pre-wrap; vertical-align: middle; word-break: break-word; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    @media print { body { background: #fff; } .hoja { margin: 0; box-shadow: none; } }
  </style></head><body><div class="hoja">${tabla(plano ? `<tbody>${antes.join("")}</tbody>` : "")}${tabla(`${plano ? `<thead>${cabecera.join("")}</thead>` : ""}<tbody>${cuerpo.join("")}</tbody>`)}</div></body></html>`;
}
