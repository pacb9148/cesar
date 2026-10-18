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
// 0,19 cm en px: margen superior e izquierdo de la hoja y relleno izquierdo de las celdas.
const MARGEN_PX = 7;
const LINEA = "1px solid #000";

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
 * La hoja del ajuste (EDIFICIO) sale como el ajuste de referencia: sin los datos del siniestro, sin sombreados, títulos de la tabla en recuadro y líneas solo en los totales.
 */
export function hojaAHtml(h: HojaVista, opciones: { orientacion?: Orientacion } = {}): string {
  const con = h.celdas.filter((c) => c.txt.trim() !== "");
  const ultimaFila = con.reduce((m, c) => Math.max(m, c.r), 1);
  const ultimaCol = con.reduce((m, c) => Math.max(m, c.c), 1);
  // Las columnas sin ningún texto (p. ej. las de «Valor ajustado» cuando no hay presupuesto) no se imprimen.
  const columnas = Array.from({ length: ultimaCol }, (_, i) => i + 1).filter((c) => con.some((x) => x.c === c));
  const porContenido = columnas.map((c) => anchoDeContenido(h, c));
  const anchos = porContenido.map((a, i) => a ?? h.anchos[columnas[i] - 1] ?? 64);
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

  // Bloque de totales: líneas encima del primero y debajo del «Equivalente…», y doble línea bajo «Valor a indemnizar».
  const textoDesc = (r: number) => celdas.get(`${r},2`)?.txt.trim() ?? "";
  const filaDe = (re: RegExp) => Array.from({ length: ultimaFila }, (_, i) => i + 1).find((r) => re.test(textoDesc(r)));
  const totalDirecto = plano ? filaDe(/^Total directo/) : undefined;
  const equivalente = plano ? filaDe(/^Equivalente en moneda/) : undefined;
  const valorIndemnizar = plano ? filaDe(/^Valor a indemnizar/) : undefined;
  // Primera columna de cada grupo de valores (la que lleva «u/m» en los títulos) y la de OBS: ahí van las líneas verticales del bloque de totales.
  const inicioGrupo = new Set(columnas.filter((c) => celdas.get(`11,${c}`)?.txt.trim() === "u/m" || celdas.get(`10,${c}`)?.txt.trim() === "OBS"));

  const fila = (r: number) => {
    const tds: string[] = [];
    columnas.forEach((c, i) => {
      const k = `${r},${c}`;
      if (cubiertas.has(k)) return;
      const x = celdas.get(k);
      const m = origen.get(k);
      const visibles = m ? columnas.filter((v) => v >= m.c1 && v <= Math.min(m.c2, ultimaCol)).length : 1;
      const span = m ? ` colspan="${Math.max(1, visibles)}" rowspan="${m.r2 - m.r1 + 1}"` : "";
      const al = x?.al ?? (x && NUMERO.test(x.txt) ? "right" : "left");
      const corta = porContenido[i] !== null;
      const fondo = plano ? undefined : x?.fondo;
      const bordes: string[] = [];
      if (plano) {
        if (repetir.includes(r)) bordes.push(`border:${LINEA}`);
        const enTotales = totalDirecto !== undefined && valorIndemnizar !== undefined && r >= totalDirecto && r <= valorIndemnizar;
        if (enTotales && c >= 2) {
          if (r === totalDirecto) bordes.push(`border-top:${LINEA}`);
          if (r === equivalente) bordes.push(`border-bottom:${LINEA}`);
          if (r === valorIndemnizar) bordes.push(`border-top:${LINEA}`, "border-bottom:3px double #000");
          if (inicioGrupo.has(c)) bordes.push(`border-left:${LINEA}`);
        }
      }
      const estilo = [corta ? "white-space:nowrap" : "", fondo ? `background:${fondo}` : "", `color:${colorSobre(fondo)}`, x?.b ? "font-weight:700" : "", `text-align:${al}`, ...bordes].filter(Boolean).join(";");
      tds.push(`<td${span} style="${estilo}">${x ? esc(x.txt) : ""}</td>`);
    });
    const alto = h.altos[r - 1];
    return `<tr${alto ? ` style="height:${alto}px"` : ""}>${tds.join("")}</tr>`;
  };

  const filas = Array.from({ length: ultimaFila }, (_, i) => i + 1);
  // Sin los datos del siniestro (filas anteriores a los títulos); los títulos repetidos, en el thead; el resto, después.
  const cabecera = filas.filter((r) => repetir.includes(r)).map(fila);
  const cuerpo = filas.filter((r) => !repetir.length || r > repetir[repetir.length - 1]).map(fila);
  const colgroup = `<colgroup>${anchos.map((w) => `<col style="width:${w}px">`).join("")}</colgroup>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(h.nombre)}</title><style>
    @page { size: A4 ${orientacion === "horizontal" ? "landscape" : "portrait"}; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #6b7280; font: 11px Arial, Helvetica, sans-serif; color: #000; }
    .hoja { background: #fff; width: ${Math.ceil(total * escala) + MARGEN_PX}px; margin: 16px auto; padding: ${MARGEN_PX}px 0 0 ${MARGEN_PX}px; box-shadow: 0 1px 6px rgba(0,0,0,.4); }
    table { border-collapse: collapse; table-layout: fixed; width: ${total}px; zoom: ${escala}; }
    td { padding: ${plano ? "2px" : "1px"} 4px ${plano ? "2px" : "1px"} ${MARGEN_PX}px; ${plano ? "border: 0;" : "border: 1px solid #d4d4d8;"} overflow: hidden; white-space: pre-wrap; vertical-align: middle; word-break: break-word; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    @media print { body { background: #fff; } .hoja { margin: 0; box-shadow: none; } }
  </style></head><body><div class="hoja"><table>${colgroup}${plano ? `<thead>${cabecera.join("")}</thead>` : ""}<tbody>${cuerpo.join("")}</tbody></table></div></body></html>`;
}
