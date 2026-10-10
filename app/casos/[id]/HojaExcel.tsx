"use client";

import { useMemo, useRef, useState } from "react";
import type { CambioFormato, HojaVista } from "@/lib/docs/vista-xlsx";
import { colorSobre } from "@/lib/docs/contraste";

export type CambioHoja = { col?: [number, number]; fila?: [number, number]; ajuste?: boolean };

const CARACTER_PX = 6.6; // ancho medio de un carácter a 12 px
const ANCHO_VACIO = 64; // columna sin datos (8,43 caracteres de Excel)
const COLS_MIN = 26; // como Excel: siempre hay columnas vacías a la derecha (hasta la Z como mínimo)
const COLS_MAX = 60;
const FILAS_EXTRA = 20;
const FILAS_MAX = 300;

export const colLetra = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/**
 * Hoja de cálculo editable. Todas las columnas y filas se pueden ajustar para leer mejor: se arrastra el borde del encabezado
 * (ancho) o del número (alto), el doble clic lo ajusta solo, y «Ajustar texto» parte el texto largo dentro de la celda.
 * Los cambios se informan hacia arriba y se guardan en el propio archivo.
 */
export default function HojaExcel({ h, ediciones, alEditar, alFormato, pendiente, zoom, maximizada }: { h: HojaVista; pendiente: CambioFormato; ediciones: Map<string, string>; alEditar: (r: number, c: number, v: string, original: string) => void; alFormato: (c: CambioHoja) => void; zoom: number; maximizada: boolean }) {
  const [activa, setActiva] = useState<{ r: number; c: number } | null>(null);
  // Al volver a una hoja se parte de lo ya ajustado y todavía sin guardar, no de lo guardado en el archivo.
  const nCols = Math.min(COLS_MAX, Math.max(h.columnas + 6, COLS_MIN));
  const nFilas = Math.min(FILAS_MAX, h.filas + FILAS_EXTRA);
  const [anchos, setAnchos] = useState(() => Array.from({ length: nCols }, (_, i) => Math.max(40, pendiente.columnas?.find((x) => x.hoja === h.nombre && x.c === i + 1)?.ancho ?? h.anchos[i] ?? ANCHO_VACIO)));
  const [altos, setAltos] = useState(() => Array.from({ length: nFilas }, (_, i) => pendiente.filas?.find((x) => x.hoja === h.nombre && x.r === i + 1)?.alto ?? h.altos[i] ?? 0));
  const [ajuste, setAjuste] = useState(() => pendiente.ajusteTexto?.find((x) => x.hoja === h.nombre)?.activo ?? h.ajusteTexto);
  const arrastre = useRef<{ tipo: "col" | "fila"; i: number; ini: number; tam: number; ultimo: number } | null>(null);
  const celdas = useMemo(() => new Map(h.celdas.map((c) => [`${c.r},${c.c}`, c])), [h]);
  const origen = useMemo(() => new Map(h.combinadas.map((m) => [`${m.r1},${m.c1}`, m])), [h]);
  const tapadas = useMemo(() => {
    const s = new Set<string>();
    for (const m of h.combinadas) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) s.add(`${r},${c}`);
    return s;
  }, [h]);
  const filas = Array.from({ length: nFilas }, (_, i) => i + 1);
  const cols = Array.from({ length: nCols }, (_, i) => i + 1);
  // El ancho de la tabla es la suma de sus columnas: no se estira hasta el borde, así siempre queda espacio vacío para ajustar hacia ambos lados.
  const anchoTabla = 36 + anchos.reduce((a, b) => a + b, 0);
  const th = { position: "sticky" as const, top: 0, background: "#e5e7eb", color: "#111827", border: "1px solid #cbd0d8", fontWeight: 600, fontSize: 11, padding: "1px 4px", zIndex: 1 };

  const iniciar = (e: React.PointerEvent<HTMLElement>, tipo: "col" | "fila", i: number) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // sigue el arrastre aunque el puntero salga del agarre
    } catch {
      /* sin captura el arrastre sigue funcionando mientras el puntero esté sobre la hoja */
    }
    const medidaFila = (e.currentTarget.closest("tr")?.getBoundingClientRect().height ?? 20) / zoom;
    const tam = tipo === "col" ? anchos[i - 1] : altos[i - 1] || medidaFila;
    arrastre.current = { tipo, i, ini: tipo === "col" ? e.clientX : e.clientY, tam, ultimo: tam };
  };
  const mover = (e: React.PointerEvent<HTMLElement>) => {
    const a = arrastre.current;
    if (!a) return;
    const d = ((a.tipo === "col" ? e.clientX : e.clientY) - a.ini) / zoom;
    const nuevo = Math.min(900, Math.max(a.tipo === "col" ? 40 : 14, Math.round(a.tam + d)));
    a.ultimo = nuevo;
    if (a.tipo === "col") setAnchos((v) => v.map((x, k) => (k === a.i - 1 ? nuevo : x)));
    else setAltos((v) => v.map((x, k) => (k === a.i - 1 ? nuevo : x)));
  };
  const soltar = () => {
    const a = arrastre.current;
    arrastre.current = null;
    if (!a || a.ultimo === a.tam) return;
    alFormato(a.tipo === "col" ? { col: [a.i, a.ultimo] } : { fila: [a.i, a.ultimo] });
  };

  /** Ancho que muestra todo el texto de la columna (sin contar las celdas combinadas, que reparten su ancho). */
  const anchoAlContenido = (c: number) => {
    let max = 0;
    for (const x of h.celdas) if (x.c === c && x.c <= h.columnas && !origen.has(`${x.r},${x.c}`)) max = Math.max(max, x.txt.length);
    return Math.min(520, Math.max(40, Math.round(max * CARACTER_PX + 14)));
  };
  const ajustarColumna = (c: number) => {
    const w = anchoAlContenido(c);
    setAnchos((v) => v.map((x, k) => (k === c - 1 ? w : x)));
    alFormato({ col: [c, w] });
  };
  const ajustarTodas = () => {
    cols.forEach((c) => {
      const w = anchoAlContenido(c);
      if (w !== anchos[c - 1]) alFormato({ col: [c, w] });
    });
    setAnchos(cols.map(anchoAlContenido));
  };
  const alternarAjuste = () => {
    setAjuste(!ajuste);
    alFormato({ ajuste: !ajuste });
  };
  const restablecerFila = (r: number) => {
    setAltos((v) => v.map((x, k) => (k === r - 1 ? 0 : x)));
    alFormato({ fila: [r, 0] });
  };
  const agarre = (tipo: "col" | "fila"): React.CSSProperties =>
    tipo === "col"
      ? { position: "absolute", top: 0, right: 0, bottom: 0, width: 7, cursor: "col-resize", zIndex: 3, touchAction: "none", borderRight: "3px solid rgba(71,85,105,.6)" }
      : { position: "absolute", left: 0, right: 0, bottom: 0, height: 7, cursor: "row-resize", zIndex: 3, touchAction: "none", borderBottom: "3px solid rgba(71,85,105,.6)" };

  return (
    <div className={maximizada ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--texto)]">
        <button type="button" className="btn btn-sec !px-2 !py-1 text-xs" onClick={ajustarTodas} title="Ancha cada columna lo justo para ver todo su contenido">Ajustar columnas al contenido</button>
        <button type="button" className="btn btn-sec !px-2 !py-1 text-xs" aria-pressed={ajuste} onClick={alternarAjuste} title="Parte el texto largo en varias líneas dentro de la celda">{ajuste ? "Ajuste de texto activado" : "Ajustar texto de las celdas"}</button>
        <span>Arrastra el borde de una letra para el ancho de la columna y el de un número para el alto de la fila; doble clic ajusta solo.</span>
      </div>
      <div className={`overflow-auto ${maximizada ? "min-h-0 flex-1" : ""}`} style={{ maxHeight: maximizada ? undefined : "62vh", background: "#fff", color: "#111827", border: "1px solid #cbd0d8" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed", width: anchoTabla, zoom }}>
          <colgroup>
            <col style={{ width: 36 }} />
            {anchos.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...th, left: 0, zIndex: 2 }} />
              {cols.map((c) => (
                <th key={c} style={th}>
                  {colLetra(c)}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Ancho de la columna ${colLetra(c)}`}
                    title="Arrastra para cambiar el ancho; doble clic para ajustarlo al contenido"
                    style={agarre("col")}
                    onPointerDown={(e) => iniciar(e, "col", c)}
                    onPointerMove={mover}
                    onPointerUp={soltar}
                    onDoubleClick={() => ajustarColumna(c)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((r) => (
              <tr key={r} style={{ height: altos[r - 1] || undefined }}>
                <th style={{ ...th, position: "sticky", left: 0, top: "auto", background: "#e5e7eb", textAlign: "center" }}>
                  {r}
                  <span
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label={`Alto de la fila ${r}`}
                    title="Arrastra para cambiar el alto; doble clic para volver al alto automático"
                    style={agarre("fila")}
                    onPointerDown={(e) => iniciar(e, "fila", r)}
                    onPointerMove={mover}
                    onPointerUp={soltar}
                    onDoubleClick={() => restablecerFila(r)}
                  />
                </th>
                {cols.map((c) => {
                  const k = `${r},${c}`;
                  if (tapadas.has(k)) return null;
                  const m = origen.get(k);
                  const x = celdas.get(k);
                  const editada = ediciones.get(`${r},${c}`);
                  const esFormula = !!x?.f;
                  const mostrar = editada ?? x?.txt ?? "";
                  const enEdicion = activa?.r === r && activa.c === c;
                  return (
                    <td
                      key={c}
                      colSpan={m ? m.c2 - m.c1 + 1 : 1}
                      rowSpan={m ? m.r2 - m.r1 + 1 : 1}
                      title={esFormula ? `Fórmula: =${x!.f} (se recalcula sola)` : "Clic para editar"}
                      onClick={() => !esFormula && setActiva({ r, c })}
                      style={{ border: "1px solid #e1e4ea", padding: enEdicion ? 0 : "1px 4px", background: editada !== undefined ? "#fde68a" : (x?.fondo ?? "#fff"), color: editada !== undefined ? "#111827" : colorSobre(x?.fondo), fontWeight: x?.b ? 700 : 400, textAlign: x?.al ?? (x && /^-?[\d.,%]+$/.test(x.txt) ? "right" : "left"), whiteSpace: ajuste ? "pre-wrap" : "nowrap", wordBreak: ajuste ? "break-word" : undefined, verticalAlign: ajuste ? "top" : undefined, overflow: "hidden", textOverflow: ajuste ? undefined : "ellipsis", cursor: esFormula ? "default" : "text" }}
                    >
                      {enEdicion ? (
                        <input
                          autoFocus
                          defaultValue={editada ?? x?.raw ?? ""}
                          aria-label={`Celda ${colLetra(c)}${r}`}
                          style={{ width: "100%", border: "2px solid #2563eb", padding: "0 3px", font: "inherit", background: "#fff", color: "#111827" }}
                          onBlur={(e) => {
                            alEditar(r, c, e.target.value, x?.raw ?? "");
                            setActiva(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setActiva(null);
                          }}
                        />
                      ) : (
                        mostrar
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
