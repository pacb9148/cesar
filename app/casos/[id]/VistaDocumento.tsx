"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BotonIcono } from "@/components/Iconos";
import type { VistaDocumento as Vista } from "@/lib/caso/edicion-documentos";
import type { BloqueVista, ParrafoVista, RunVista } from "@/lib/docs/vista-docx";
import type { HojaVista } from "@/lib/docs/vista-xlsx";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function runHtml(r: RunVista): string {
  if (r.salto) return "<br>";
  const st = [r.b && "font-weight:700", r.i && "font-style:italic", r.u && "text-decoration:underline", r.sz && `font-size:${(r.sz * 4) / 3}px`, r.color && `color:${r.color}`, r.sc && "font-variant:small-caps"].filter(Boolean).join(";");
  return st ? `<span style="${st}">${esc(r.t)}</span>` : esc(r.t);
}

type Cambio = (i: number, texto: string, original: string) => void;

/** Párrafo editable. Su contenido se pinta una sola vez (innerHTML fijo): lo que el usuario escribe no lo pisa React. */
function Parrafo({ p, alCambiar }: { p: ParrafoVista; alCambiar: Cambio }) {
  const html = useMemo(() => p.runs.map(runHtml).join("") + p.imagenes.map((m) => `<img src="${m.src}" width="${m.w}" height="${m.h}" style="max-width:100%;height:auto;vertical-align:middle" alt="" contenteditable="false">`).join(""), [p]);
  return (
    <p
      data-i={p.i}
      contentEditable={p.editable}
      suppressContentEditableWarning
      spellCheck
      onInput={(e) => {
        const el = e.currentTarget;
        const t = el.innerText.replace(/ /g, " ").replace(/\n$/, "");
        const cambiado = t !== p.texto.replace(/ /g, " ");
        if (cambiado) el.setAttribute("data-sucio", "1");
        else el.removeAttribute("data-sucio");
        alCambiar(p.i, t, p.texto);
      }}
      style={{ margin: "0 0 6px", minHeight: "1.2em", textAlign: p.jc, paddingLeft: p.sangria, whiteSpace: "pre-wrap" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Bloques({ bloques, alCambiar }: { bloques: BloqueVista[]; alCambiar: Cambio }) {
  return (
    <>
      {bloques.map((b, k) =>
        b.tipo === "p" ? (
          <Parrafo key={`${b.i}-${k}`} p={b} alCambiar={alCambiar} />
        ) : (
          <table key={k} style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed", margin: "4px 0", border: "1px dotted #c7ccd4" }}>
            <colgroup>{b.anchos.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <tbody>
              {b.filas.map((f, i) => (
                <tr key={i}>
                  {f.celdas.map((c, j) => (
                    <td key={j} colSpan={c.span} style={{ verticalAlign: "top", padding: "1px 4px", border: "1px dotted #c7ccd4" }}>
                      <Bloques bloques={c.bloques} alCambiar={alCambiar} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ),
      )}
    </>
  );
}

const colLetra = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

function Hoja({ h, ediciones, alEditar }: { h: HojaVista; ediciones: Map<string, string>; alEditar: (r: number, c: number, v: string, original: string) => void }) {
  const [activa, setActiva] = useState<{ r: number; c: number } | null>(null);
  const celdas = useMemo(() => new Map(h.celdas.map((c) => [`${c.r},${c.c}`, c])), [h]);
  const origen = useMemo(() => new Map(h.combinadas.map((m) => [`${m.r1},${m.c1}`, m])), [h]);
  const tapadas = useMemo(() => {
    const s = new Set<string>();
    for (const m of h.combinadas) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) s.add(`${r},${c}`);
    return s;
  }, [h]);
  const filas = Array.from({ length: h.filas }, (_, i) => i + 1);
  const cols = Array.from({ length: h.columnas }, (_, i) => i + 1);
  const th = { position: "sticky" as const, top: 0, background: "#e5e7eb", color: "#111827", border: "1px solid #cbd0d8", fontWeight: 600, fontSize: 11, padding: "1px 4px", zIndex: 1 };
  return (
    <div className="overflow-auto" style={{ maxHeight: "62vh", background: "#fff", color: "#111827", border: "1px solid #cbd0d8" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed", minWidth: "100%" }}>
        <colgroup>
          <col style={{ width: 36 }} />
          {h.anchos.map((w, i) => <col key={i} style={{ width: Math.max(40, w) }} />)}
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...th, left: 0, zIndex: 2 }} />
            {cols.map((c) => <th key={c} style={th}>{colLetra(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr key={r}>
              <th style={{ ...th, position: "sticky", left: 0, top: "auto", background: "#e5e7eb", textAlign: "center" }}>{r}</th>
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
                    style={{ border: "1px solid #e1e4ea", padding: enEdicion ? 0 : "1px 4px", background: editada !== undefined ? "#fde68a" : (x?.fondo ?? "#fff"), color: "#111827", fontWeight: x?.b ? 700 : 400, textAlign: x?.al ?? (x && /^-?[\d.,%]+$/.test(x.txt) ? "right" : "left"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: esFormula ? "default" : "text", fontStyle: esFormula ? "normal" : "normal" }}
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
  );
}

/** Vista previa y edición de un entregable (Word o Excel) antes de descargarlo. Guardar rehace el PDF y el ZIP que dependen de él. */
export default function VistaDocumento({ casoId, archivoId, nombre, onCerrar, onGuardado }: { casoId: string; archivoId: string; nombre: string; onCerrar: () => void; onGuardado: () => void }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [hoja, setHoja] = useState(0);
  const [version, setVersion] = useState(0); // fuerza a repintar el Word tras guardar o descartar
  const textos = useRef(new Map<number, string>());
  const [nTextos, setNTextos] = useState(0);
  const [celdas, setCeldas] = useState(new Map<string, string>()); // "hoja|r,c" → valor
  const dialogo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/casos/${casoId}/archivos/${archivoId}/vista`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Vista & { error?: string };
        if (!vivo) return;
        if (!r.ok) setError(j.error ?? `Error ${r.status}`);
        else setVista(j);
      })
      .catch(() => vivo && setError("No se pudo cargar la vista previa."));
    return () => {
      vivo = false;
    };
  }, [casoId, archivoId]);

  useEffect(() => {
    dialogo.current?.focus();
    const t = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", t);
    return () => window.removeEventListener("keydown", t);
  }, [onCerrar]);

  const cambios = vista?.tipo === "xlsx" ? celdas.size : nTextos;

  async function guardar() {
    if (!vista || cambios === 0) return;
    setGuardando(true);
    setError(null);
    const cuerpo =
      vista.tipo === "docx"
        ? { textos: Object.fromEntries(textos.current) }
        : { celdas: [...celdas].map(([k, valor]) => { const [h, rc] = k.split("|"); const [r, c] = rc.split(",").map(Number); return { hoja: h, r, c, valor }; }) };
    const r = await fetch(`/api/casos/${casoId}/archivos/${archivoId}/vista`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; avisos?: string[]; vista?: Vista };
    setGuardando(false);
    if (!r.ok || !j.vista) return setError(j.error ?? `Error ${r.status}`);
    setVista(j.vista);
    setAvisos(j.avisos ?? []);
    textos.current.clear();
    setNTextos(0);
    setCeldas(new Map());
    setVersion((v) => v + 1);
    onGuardado();
  }

  const alCambiarTexto: Cambio = (i, t, original) => {
    if (t === original.replace(/ /g, " ")) textos.current.delete(i);
    else textos.current.set(i, t);
    setNTextos(textos.current.size);
  };

  const hojaActual = vista?.tipo === "xlsx" ? vista.hojas[hoja] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div ref={dialogo} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Vista previa de ${nombre}`} className="panel flex max-h-full w-full max-w-5xl flex-col gap-3 overflow-hidden p-3 outline-none sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[color:var(--texto)]">{nombre}</h2>
            <p className="text-xs text-[color:var(--suave)]">
              {vista?.tipo === "xlsx"
                ? "Clic en una celda para editarla. Las celdas con fórmula se recalculan solas al guardar."
                : "Haz clic en cualquier texto para corregirlo. Los cambios se guardan en el documento; el PDF y el paquete ZIP se rehacen."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span role="status" className="text-xs text-[color:var(--texto)]">{cambios > 0 ? `${cambios} cambio(s) sin guardar` : "Sin cambios"}</span>
            <BotonIcono icono="guardar" etiqueta={guardando ? "Guardando…" : "Guardar cambios"} deshabilitado={guardando || cambios === 0} onClick={guardar} />
            <BotonIcono icono="cerrar" etiqueta="Cerrar" onClick={onCerrar} />
          </div>
        </div>
        {error && <p role="alert" className="aviso aviso-error">{error}</p>}
        {avisos.map((a, i) => <p key={i} role="status" className="aviso aviso-alerta">{a}</p>)}
        {!vista && !error && <p className="texto-suave text-sm">Cargando vista previa…</p>}

        {vista?.tipo === "docx" && (
          <div className="overflow-auto rounded-lg border border-[color:var(--borde)] bg-[#6b7280] p-3" style={{ maxHeight: "68vh" }}>
            <style>{`.doc-ed p[contenteditable="true"]:hover{background:rgba(37,99,235,.07)}.doc-ed p[contenteditable="true"]:focus{outline:2px solid #2563eb;outline-offset:1px}.doc-ed p[data-sucio="1"]{box-shadow:inset 3px 0 0 #d97706}`}</style>
            <div key={version} className="doc-ed mx-auto" style={{ background: "#fff", color: "#000", maxWidth: 816, padding: "48px 56px", fontFamily: '"Times New Roman", "Liberation Serif", serif', fontSize: 16, lineHeight: 1.3, boxShadow: "0 1px 6px rgba(0,0,0,.4)" }}>
              <Bloques bloques={vista.bloques} alCambiar={alCambiarTexto} />
            </div>
          </div>
        )}

        {vista?.tipo === "xlsx" && hojaActual && (
          <>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Hojas del Excel">
              {vista.hojas.map((h, i) => (
                <button key={h.nombre} type="button" role="tab" aria-selected={hoja === i} className={`btn ${hoja === i ? "" : "btn-sec"} !px-3 !py-1 text-sm`} onClick={() => setHoja(i)}>
                  {h.nombre}
                </button>
              ))}
            </div>
            <Hoja
              key={`${hojaActual.nombre}-${version}`}
              h={hojaActual}
              ediciones={new Map([...celdas].filter(([k]) => k.startsWith(`${hojaActual.nombre}|`)).map(([k, v]) => [k.split("|")[1], v]))}
              alEditar={(r, c, v, original) =>
                setCeldas((m) => {
                  const n = new Map(m);
                  const k = `${hojaActual.nombre}|${r},${c}`;
                  if (v === original) n.delete(k);
                  else n.set(k, v);
                  return n;
                })
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
