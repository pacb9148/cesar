"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BotonIcono } from "@/components/Iconos";
import type { VistaDocumento as Vista } from "@/lib/caso/edicion-documentos";
import type { BloqueVista, ParrafoVista, RunEdicion, RunVista } from "@/lib/docs/vista-docx";
import type { ArchivoMeta } from "@/lib/caso/repositorio";
import VentanaModal from "@/components/VentanaModal";
import EditorFoto from "./EditorFoto";
import type { HojaVista } from "@/lib/docs/vista-xlsx";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function runHtml(r: RunVista): string {
  if (r.salto) return "<br>";
  const st = [r.b && "font-weight:700", r.i && "font-style:italic", r.u && "text-decoration:underline", r.sz && `font-size:${(r.sz * 4) / 3}px`, r.color && `color:${r.color}`, r.sc && "font-variant:small-caps"].filter(Boolean).join(";");
  return st ? `<span style="${st}">${esc(r.t)}</span>` : esc(r.t);
}

/** Lo que el Word necesita saber de cada párrafo tocado: su elemento (de él se leen el texto y el formato al guardar). */
type Contexto = {
  alCambiar: (i: number, el: HTMLElement | null) => void;
  alFoco: (i: number) => void;
  alClicFoto: (fotoId: string) => void;
  alClicImagen: (el: HTMLImageElement) => void;
  eliminados: Set<number>;
};

/** Párrafo editable. Su contenido se pinta una sola vez (innerHTML fijo): lo que el usuario escribe no lo pisa React. */
function Parrafo({ p, c }: { p: ParrafoVista; c: Contexto }) {
  const html = useMemo(
    () =>
      p.runs.map(runHtml).join("") +
      p.imagenes
        .map((m) => `<img src="${m.src}" width="${m.w}" height="${m.h}" style="max-width:100%;height:auto;vertical-align:middle;cursor:pointer;${m.h >= 20 ? `outline:1px dashed ${m.fotoId ? "#2563eb" : "#9ca3af"};outline-offset:1px` : ""}" alt="" contenteditable="false" data-idx="${m.idx}"${m.fotoId ? ` data-foto="${m.fotoId}" title="Clic para editar esta foto"` : ` title="Clic para cambiar su tamaño o quitarla"`}>`)
        .join(""),
    [p],
  );
  const borrado = c.eliminados.has(p.i);
  return (
    <p
      data-i={p.i}
      contentEditable={p.editable && !borrado}
      suppressContentEditableWarning
      spellCheck
      onFocus={() => c.alFoco(p.i)}
      onInput={(e) => {
        const el = e.currentTarget;
        const sucio = el.innerHTML !== html;
        if (sucio) el.setAttribute("data-sucio", "1");
        else el.removeAttribute("data-sucio");
        c.alCambiar(p.i, sucio ? el : null);
      }}
      onKeyDown={(e) => {
        // Enter no parte el párrafo (el navegador lo ensuciaría): para uno nuevo está el botón «Insertar párrafo debajo».
        if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (!(t instanceof HTMLImageElement)) return;
        // Una foto del caso se abre en su editor; cualquier otra imagen (gráfico, firma, fachada) se selecciona para cambiar su tamaño.
        if (t.dataset.foto) c.alClicFoto(t.dataset.foto);
        else c.alClicImagen(t);
      }}
      style={{ margin: "0 0 6px", minHeight: "1.2em", textAlign: p.jc, paddingLeft: p.sangria, whiteSpace: "pre-wrap", opacity: borrado ? 0.45 : 1, textDecoration: borrado ? "line-through" : undefined }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Bloques({ bloques, c }: { bloques: BloqueVista[]; c: Contexto }) {
  return (
    <>
      {bloques.map((b, k) =>
        b.tipo === "p" ? (
          <Parrafo key={`${b.i}-${k}`} p={b} c={c} />
        ) : (
          <table key={k} style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed", margin: "4px 0", border: "1px dotted #c7ccd4" }}>
            <colgroup>{b.anchos.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <tbody>
              {b.filas.map((f, i) => (
                <tr key={i}>
                  {f.celdas.map((ce, j) => (
                    <td key={j} colSpan={ce.span} style={{ verticalAlign: "top", padding: "1px 4px", border: "1px dotted #c7ccd4" }}>
                      <Bloques bloques={ce.bloques} c={c} />
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

/** Lee el contenido con formato de un párrafo editado: tramos con negrita, cursiva y subrayado. */
function leerRuns(el: HTMLElement): RunEdicion[] {
  const out: RunEdicion[] = [];
  const recorrer = (n: Node, f: { b: boolean; i: boolean; u: boolean }) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent ?? "").replace(/\u00a0/g, " ");
      if (t) out.push({ t, ...(f.b ? { b: true } : {}), ...(f.i ? { i: true } : {}), ...(f.u ? { u: true } : {}) });
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    if (n.tagName === "IMG") return;
    if (n.tagName === "BR") {
      out.push({ t: "\n", ...(f.b ? { b: true } : {}) });
      return;
    }
    const st = n.style;
    const peso = st.fontWeight;
    const nf = {
      b: f.b || n.tagName === "B" || n.tagName === "STRONG" || peso === "bold" || Number(peso) >= 600,
      i: f.i || n.tagName === "I" || n.tagName === "EM" || st.fontStyle === "italic",
      u: f.u || n.tagName === "U" || st.textDecorationLine.includes("underline") || st.textDecoration.includes("underline"),
    };
    n.childNodes.forEach((h) => recorrer(h, nf));
  };
  el.childNodes.forEach((h) => recorrer(h, { b: false, i: false, u: false }));
  return out;
}

const colLetra = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

function Hoja({ h, ediciones, alEditar, zoom, maximizada }: { h: HojaVista; ediciones: Map<string, string>; alEditar: (r: number, c: number, v: string, original: string) => void; zoom: number; maximizada: boolean }) {
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
    <div className={`overflow-auto ${maximizada ? "min-h-0 flex-1" : ""}`} style={{ maxHeight: maximizada ? undefined : "62vh", background: "#fff", color: "#111827", border: "1px solid #cbd0d8" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed", minWidth: "100%", zoom }}>
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

type Pestana = "editar" | "pdf";

/** Vista previa y edición de un entregable (Word o Excel) antes de descargarlo. Guardar rehace lo que depende de él (cuadro y totales del Word, PDF, ZIP). */
export default function VistaDocumento({ casoId, archivoId, nombre, onCerrar, onGuardado }: { casoId: string; archivoId: string; nombre: string; onCerrar: () => void; onGuardado: () => void }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [hoja, setHoja] = useState(0);
  const [version, setVersion] = useState(0); // fuerza a repintar el Word tras guardar o recargar
  const [pestana, setPestana] = useState<Pestana>("editar");
  const sucios = useRef(new Map<number, HTMLElement>());
  const [nTextos, setNTextos] = useState(0);
  const [eliminados, setEliminados] = useState<Set<number>>(new Set());
  const [nuevos, setNuevos] = useState<{ despuesDe: number; texto: string }[]>([]);
  const foco = useRef<number | null>(null);
  const [celdas, setCeldas] = useState(new Map<string, string>()); // "hoja|r,c" → valor
  const [foto, setFoto] = useState<ArchivoMeta | null>(null);
  const [pdf, setPdf] = useState<{ url?: string; error?: string; cargando: boolean }>({ cargando: false });
  const [zoom, setZoom] = useState(1);
  const [imgSel, setImgSel] = useState<{ idx: number; w: number; h: number } | null>(null);
  const imgEl = useRef<HTMLImageElement | null>(null); // la imagen seleccionada en el documento (se modifica su estilo directamente)
  const [imgCambios, setImgCambios] = useState<Map<number, { w: number; h: number }>>(new Map()); // tamaño en px de pantalla
  const [imgQuitar, setImgQuitar] = useState<Set<number>>(new Set());
  const [proporcion, setProporcion] = useState(true);

  const aplicarVista = (j: Vista) => {
    setVista(j);
    sucios.current.clear();
    setNTextos(0);
    setEliminados(new Set());
    setNuevos([]);
    setCeldas(new Map());
    setImgSel(null);
    setImgCambios(new Map());
    setImgQuitar(new Set());
    setVersion((v) => v + 1);
  };
  const traer = async () => {
    const r = await fetch(`/api/casos/${casoId}/archivos/${archivoId}/vista`, { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as Vista & { error?: string };
    return { ok: r.ok, j, estado: r.status };
  };
  const cargar = async () => {
    const { ok, j, estado } = await traer();
    if (!ok) return setError((j as { error?: string }).error ?? `Error ${estado}`);
    aplicarVista(j);
  };

  useEffect(() => {
    let vivo = true;
    traer()
      .then(({ ok, j, estado }) => {
        if (!vivo) return;
        if (!ok) setError((j as { error?: string }).error ?? `Error ${estado}`);
        else aplicarVista(j);
      })
      .catch(() => vivo && setError("No se pudo cargar la vista previa."));
    return () => {
      vivo = false;
    };
  }, [casoId, archivoId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = (e: KeyboardEvent) => e.key === "Escape" && !foto && onCerrar();
    window.addEventListener("keydown", t);
    return () => window.removeEventListener("keydown", t);
  }, [onCerrar, foto]);

  const cambios = vista?.tipo === "xlsx" ? celdas.size : nTextos + eliminados.size + nuevos.length + imgCambios.size + imgQuitar.size;

  async function guardar(): Promise<boolean> {
    if (!vista || cambios === 0) return true;
    setGuardando(true);
    setError(null);
    setInfo(null);
    const cuerpo =
      vista.tipo === "docx"
        ? {
            word: {
              parrafos: Object.fromEntries([...sucios.current].filter(([i]) => !eliminados.has(i)).map(([i, el]) => [String(i), leerRuns(el)])),
              insertar: nuevos.filter((n) => n.texto.trim() !== "").map((n) => ({ despuesDe: n.despuesDe, runs: [{ t: n.texto }] })),
              eliminar: [...eliminados],
              imagenes: [...imgCambios].map(([idx, v]) => ({ idx, cx: Math.round(v.w * 9525), cy: Math.round(v.h * 9525) })),
              quitarImagenes: [...imgQuitar],
            },
          }
        : { celdas: [...celdas].map(([k, valor]) => { const [h, rc] = k.split("|"); const [r, c] = rc.split(",").map(Number); return { hoja: h, r, c, valor }; }) };
    const r = await fetch(`/api/casos/${casoId}/archivos/${archivoId}/vista`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; avisos?: string[]; vista?: Vista };
    setGuardando(false);
    if (!r.ok || !j.vista) {
      setError(j.error ?? `Error ${r.status}`);
      return false;
    }
    setVista(j.vista);
    setAvisos(j.avisos ?? []);
    setInfo(vista.tipo === "xlsx" ? "Guardado. El cuadro de pérdida del informe y sus totales se actualizaron solos." : "Guardado en el documento.");
    sucios.current.clear();
    setNTextos(0);
    setEliminados(new Set());
    setNuevos([]);
    setCeldas(new Map());
    setImgSel(null);
    setImgCambios(new Map());
    setImgQuitar(new Set());
    setVersion((v) => v + 1);
    setPdf({ cargando: false });
    onGuardado();
    return true;
  }

  const contexto: Contexto = {
    alCambiar: (i, el) => {
      if (el) sucios.current.set(i, el);
      else sucios.current.delete(i);
      setNTextos(sucios.current.size);
    },
    alFoco: (i) => (foco.current = i),
    // Doble clic en una foto: se guarda lo pendiente y se abre su editor; al terminar, el documento ya trae la foto como quedó.
    alClicFoto: async (fotoId) => {
      if (!(await guardar())) return;
      const r = await fetch(`/api/casos/${casoId}/archivos`, { cache: "no-store" });
      const lista = (await r.json().catch(() => [])) as ArchivoMeta[];
      const f = lista.find((a) => a.id === fotoId);
      if (f) setFoto(f);
      else setError("No se encontró la fotografía de esta imagen.");
    },
    alClicImagen: (el) => {
      const idx = Number(el.dataset.idx);
      if (!Number.isInteger(idx)) return;
      const ya = imgCambios.get(idx);
      imgEl.current = el;
      // El tamaño del documento está en los atributos de la imagen (el renderizado puede medir 0 si aún no se pintó).
      setImgSel({ idx, w: ya?.w ?? (Number(el.getAttribute("width")) || el.width), h: ya?.h ?? (Number(el.getAttribute("height")) || el.height) });
    },
    eliminados,
  };

  /** Cambia el tamaño de la imagen seleccionada (en px de pantalla) y lo anota para guardarlo. */
  const medirImagen = (w: number, h: number) => {
    const el = imgEl.current;
    if (!imgSel || !el) return;
    el.style.maxWidth = "none";
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    setImgCambios((m) => new Map(m).set(imgSel.idx, { w, h }));
  };
  const PX_CM = 37.795;
  const anchoCm = imgSel ? (imgCambios.get(imgSel.idx)?.w ?? imgSel.w) / PX_CM : 0;
  const altoCm = imgSel ? (imgCambios.get(imgSel.idx)?.h ?? imgSel.h) / PX_CM : 0;
  const cambiarCm = (campo: "w" | "h", cm: number) => {
    if (!imgSel || !(cm > 0.3 && cm <= 30)) return;
    const w = imgCambios.get(imgSel.idx)?.w ?? imgSel.w;
    const h = imgCambios.get(imgSel.idx)?.h ?? imgSel.h;
    if (!(w > 0 && h > 0)) return;
    const px = cm * PX_CM;
    if (campo === "w") medirImagen(px, proporcion ? (px * h) / w : h);
    else medirImagen(proporcion ? (px * w) / h : w, px);
  };
  const escalarImagen = (f: number) => {
    if (!imgSel) return;
    const w = (imgCambios.get(imgSel.idx)?.w ?? imgSel.w) * f;
    const h = (imgCambios.get(imgSel.idx)?.h ?? imgSel.h) * f;
    if (!(w > 0 && h > 0)) return;
    if (w / PX_CM > 0.3 && w / PX_CM <= 30 && h / PX_CM > 0.3 && h / PX_CM <= 30) medirImagen(w, h);
  };
  const quitarImagen = () => {
    const el = imgEl.current;
    if (!imgSel || !el) return;
    const quitar = !imgQuitar.has(imgSel.idx);
    el.style.opacity = quitar ? "0.2" : "1";
    el.style.outline = quitar ? "2px dashed #dc2626" : "1px dashed #9ca3af";
    setImgQuitar((q) => {
      const n = new Set(q);
      if (quitar) n.add(imgSel.idx);
      else n.delete(imgSel.idx);
      return n;
    });
  };

  const formato = (cmd: "bold" | "italic" | "underline") => document.execCommand(cmd);
  const insertarDebajo = () => {
    if (foco.current == null) return setError("Haz clic primero en el párrafo debajo del cual quieres insertar uno nuevo.");
    setNuevos((n) => [...n, { despuesDe: foco.current!, texto: "" }]);
  };
  const quitar = () => {
    const i = foco.current;
    if (i == null) return setError("Haz clic primero en el párrafo que quieres quitar.");
    setEliminados((e) => {
      const n = new Set(e);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  };

  async function verPdf() {
    setPestana("pdf");
    if (pdf.url || pdf.cargando) return;
    setPdf({ cargando: true });
    const r = await fetch(`/api/casos/${casoId}/archivos/${archivoId}/vista?pdf=1`, { cache: "no-store" });
    if (!r.ok) return setPdf({ cargando: false, error: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Error ${r.status}` });
    setPdf({ cargando: false, url: URL.createObjectURL(await r.blob()) });
  }

  const hojaActual = vista?.tipo === "xlsx" ? vista.hojas[hoja] : null;
  const cambiarZoom = (d: number) => setZoom((z) => Math.min(2, Math.max(0.5, Math.round((z + d) * 10) / 10)));
  const controlesZoom = (
    <span className="flex items-center gap-1" role="group" aria-label="Tamaño del contenido">
      <BotonIcono icono="zoomMenos" etiqueta="Reducir el contenido" deshabilitado={zoom <= 0.5} onClick={() => cambiarZoom(-0.1)} />
      <button type="button" className="btn btn-sec !px-2 !py-1 text-xs" title="Volver al 100 %" aria-label={`Tamaño ${Math.round(zoom * 100)} %, clic para volver al 100 %`} onClick={() => setZoom(1)}>{Math.round(zoom * 100)} %</button>
      <BotonIcono icono="zoomMas" etiqueta="Ampliar el contenido" deshabilitado={zoom >= 2} onClick={() => cambiarZoom(0.1)} />
    </span>
  );

  return (
    <>
    <VentanaModal
      etiqueta={`Vista previa de ${nombre}`}
      titulo={nombre}
      subtitulo={
        vista?.tipo === "xlsx"
          ? "Clic en una celda para editarla. Las fórmulas se recalculan solas y el cuadro de pérdida del informe se actualiza al guardar."
          : "Clic en cualquier texto para corregirlo; clic en una foto para editarla; clic en un gráfico o una firma para cambiar su tamaño o quitarlo. Al guardar se rehacen el PDF y el ZIP."
      }
      onCerrar={() => !foto && onCerrar()}
      acciones={
        <>
          <span role="status" className="text-xs text-[color:var(--texto)]">{cambios > 0 ? `${cambios} cambio(s) sin guardar` : "Sin cambios"}</span>
          <BotonIcono icono="guardar" etiqueta={guardando ? "Guardando…" : "Guardar cambios"} deshabilitado={guardando || cambios === 0} onClick={() => void guardar()} />
        </>
      }
    >
      {({ maximizada }) => (
      <>
        {error && <p role="alert" className="aviso aviso-error">{error}</p>}
        {guardando && <p role="status" className="aviso aviso-ok">Guardando y rehaciendo el PDF y el paquete ZIP… puede tardar unos segundos.</p>}
        {info && <p role="status" className="aviso aviso-ok">{info}</p>}
        {avisos.map((a, i) => <p key={i} role="status" className="aviso aviso-alerta">{a}</p>)}
        {!vista && !error && <p className="texto-suave text-sm">Cargando vista previa…</p>}

        {vista?.tipo === "docx" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={`btn ${pestana === "editar" ? "" : "btn-sec"} !px-3 !py-1 text-sm`} onClick={() => setPestana("editar")}>Editar</button>
              <button type="button" className={`btn ${pestana === "pdf" ? "" : "btn-sec"} !px-3 !py-1 text-sm`} onClick={() => void verPdf()}>Vista exacta (PDF)</button>
              {pestana === "editar" && <span className="ml-auto">{controlesZoom}</span>}
              {pestana === "editar" && (
                <span className="flex items-center gap-2" role="toolbar" aria-label="Formato del texto">
                  <BotonIcono icono="negrita" etiqueta="Negrita (Ctrl+B)" onClick={() => formato("bold")} />
                  <BotonIcono icono="cursiva" etiqueta="Cursiva (Ctrl+I)" onClick={() => formato("italic")} />
                  <BotonIcono icono="subrayado" etiqueta="Subrayado (Ctrl+U)" onClick={() => formato("underline")} />
                  <BotonIcono icono="insertar" etiqueta="Insertar párrafo debajo del seleccionado" onClick={insertarDebajo} />
                  <BotonIcono icono="papelera" etiqueta="Quitar o restaurar el párrafo seleccionado" onClick={quitar} />
                </span>
              )}
            </div>
            {pestana === "editar" && imgSel && (
              <div role="group" aria-label="Propiedades de la imagen seleccionada" className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel-2)] p-2 text-sm text-[color:var(--texto)]">
                <span className="font-semibold">Imagen seleccionada{imgQuitar.has(imgSel.idx) ? " (se quitará)" : ""}</span>
                <label className="flex items-center gap-1">Ancho (cm)
                  <input type="number" step="0.1" min="0.5" max="30" className="campo w-20 px-2 py-1" aria-label="Ancho de la imagen en centímetros" value={anchoCm.toFixed(1)} onChange={(e) => cambiarCm("w", Number(e.target.value))} />
                </label>
                <label className="flex items-center gap-1">Alto (cm)
                  <input type="number" step="0.1" min="0.5" max="30" className="campo w-20 px-2 py-1" aria-label="Alto de la imagen en centímetros" value={altoCm.toFixed(1)} onChange={(e) => cambiarCm("h", Number(e.target.value))} />
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={proporcion} onChange={(e) => setProporcion(e.target.checked)} /> Mantener proporción
                </label>
                <BotonIcono icono="zoomMenos" etiqueta="Reducir la imagen un 10 %" onClick={() => escalarImagen(0.9)} />
                <BotonIcono icono="zoomMas" etiqueta="Ampliar la imagen un 10 %" onClick={() => escalarImagen(1.1)} />
                <BotonIcono icono="papelera" etiqueta={imgQuitar.has(imgSel.idx) ? "No quitar la imagen" : "Quitar la imagen del documento"} activo={imgQuitar.has(imgSel.idx)} onClick={quitarImagen} />
                <BotonIcono icono="cerrar" etiqueta="Dejar de seleccionar la imagen" onClick={() => setImgSel(null)} />
              </div>
            )}
            {pestana === "editar" ? (
              <div className={`overflow-auto rounded-lg border border-[color:var(--borde)] bg-[#6b7280] p-3 ${maximizada ? "min-h-0 flex-1" : ""}`} style={{ maxHeight: maximizada ? undefined : "64vh" }}>
                <style>{`.doc-ed p[contenteditable="true"]:hover{background:rgba(37,99,235,.07)}.doc-ed p[contenteditable="true"]:focus{outline:2px solid #2563eb;outline-offset:1px}.doc-ed p[data-sucio="1"]{box-shadow:inset 3px 0 0 #d97706}`}</style>
                <div key={version} className="doc-ed mx-auto" style={{ background: "#fff", color: "#000", maxWidth: 816, padding: "48px 56px", fontFamily: '"Times New Roman", "Liberation Serif", serif', fontSize: 16, lineHeight: 1.3, boxShadow: "0 1px 6px rgba(0,0,0,.4)", zoom }}>
                  <Bloques bloques={vista.bloques} c={contexto} />
                  {nuevos.length > 0 && (
                    <div style={{ borderTop: "2px dashed #d97706", marginTop: 12, paddingTop: 8 }}>
                      <p style={{ fontSize: 12, color: "#92400e", margin: "0 0 4px" }}>Párrafos nuevos (cada uno se inserta debajo del párrafo que tenías seleccionado):</p>
                      {nuevos.map((n, k) => (
                        <div key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                          <textarea
                            aria-label={`Párrafo nuevo ${k + 1}`}
                            value={n.texto}
                            rows={2}
                            placeholder="Escribe el texto del párrafo nuevo"
                            onChange={(e) => setNuevos((l) => l.map((x, j) => (j === k ? { ...x, texto: e.target.value } : x)))}
                            style={{ flex: 1, border: "1px solid #d97706", padding: 4, font: "inherit", background: "#fffbeb", color: "#000" }}
                          />
                          <button type="button" aria-label={`Descartar párrafo nuevo ${k + 1}`} title="Descartar" onClick={() => setNuevos((l) => l.filter((_, j) => j !== k))} style={{ border: "1px solid #9ca3af", background: "#fff", color: "#111", padding: "2px 8px", borderRadius: 4 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className={`overflow-hidden rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel-2)] ${maximizada ? "min-h-0 flex-1" : ""}`} style={{ height: maximizada ? undefined : "64vh" }}>
                {pdf.cargando && <p className="texto-suave p-4 text-sm">Generando la vista exacta con LibreOffice…</p>}
                {pdf.error && <p role="alert" className="aviso aviso-alerta m-3">{pdf.error}</p>}
                {pdf.url && <iframe title="Vista exacta del documento (PDF)" src={pdf.url} className="h-full w-full" />}
              </div>
            )}
          </>
        )}

        {vista?.tipo === "xlsx" && hojaActual && (
          <>
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Hojas del Excel">
              {vista.hojas.map((h, i) => (
                <button key={h.nombre} type="button" role="tab" aria-selected={hoja === i} className={`btn ${hoja === i ? "" : "btn-sec"} !px-3 !py-1 text-sm`} onClick={() => setHoja(i)}>
                  {h.nombre}
                </button>
              ))}
              <span className="ml-auto">{controlesZoom}</span>
            </div>
            <Hoja
              key={`${hojaActual.nombre}-${version}`}
              h={hojaActual}
              zoom={zoom}
              maximizada={maximizada}
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
      </>
      )}
    </VentanaModal>
      {foto && (
        <EditorFoto
          key={foto.id}
          casoId={casoId}
          foto={foto}
          onCerrar={() => setFoto(null)}
          onGuardado={() => {
            setFoto(null);
            setInfo("Foto actualizada en el documento.");
            void cargar().then(onGuardado);
          }}
        />
      )}
    </>
  );
}
