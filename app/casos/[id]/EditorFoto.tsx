"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BotonIcono, Icono, type NombreIcono } from "@/components/Iconos";
import VentanaModal from "@/components/VentanaModal";
import { FOTO_TAMANO_TEXTO, LEYENDA_FOTO_MAX } from "@/lib/domain/constantes";
import type { ArchivoMeta } from "@/lib/caso/repositorio";
import { EDICION_INICIAL, PROPORCION_FOTO, ZOOM_MAX, centroValido, dimensionesGiradas, encuadreDeRectangulo, girar, ventanaBase, ventanaDeRecorte, type EdicionFoto } from "@/lib/fotos/recorte";

type ColorCuadricula = "negro" | "blanco" | "gris";
type Cuadricula = { visible: boolean; cols: number; filas: number; cuadradas: boolean; diagonales: boolean; etiquetas: boolean; color: ColorCuadricula; opacidad: number; grosor: 0.5 | 1; ox: number; oy: number };

const CUADRICULA_INICIAL: Cuadricula = { visible: true, cols: 3, filas: 3, cuadradas: false, diagonales: false, etiquetas: false, color: "blanco", opacidad: 0.7, grosor: 0.5, ox: 0, oy: 0 };
const COLORES: Record<ColorCuadricula, string> = { negro: "#000000", blanco: "#ffffff", gris: "#808080" };
const CLAVE_LS = "cesar.cuadricula.v1";
const MAX_LADO = 2400;

const leerPrefs = (): Cuadricula => {
  try {
    const t = localStorage.getItem(CLAVE_LS);
    return t ? { ...CUADRICULA_INICIAL, ...(JSON.parse(t) as Partial<Cuadricula>), ox: 0, oy: 0 } : CUADRICULA_INICIAL;
  } catch {
    return CUADRICULA_INICIAL;
  }
};

/** Imagen ya girada y volteada (en el mismo orden que el servidor), a resolución de trabajo. El recorte se calcula sobre ella. */
function prepararLienzo(img: HTMLImageElement, e: EdicionFoto): HTMLCanvasElement {
  const k = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k);
  const h = Math.round(img.naturalHeight * k);
  const d = dimensionesGiradas(w, h, e.giro);
  const a = document.createElement("canvas");
  a.width = d.ancho;
  a.height = d.alto;
  const ca = a.getContext("2d")!;
  ca.translate(d.ancho / 2, d.alto / 2);
  ca.rotate((e.giro * Math.PI) / 180);
  ca.drawImage(img, -w / 2, -h / 2, w, h);
  if (!e.volteoH && !e.volteoV) return a;
  const b = document.createElement("canvas");
  b.width = d.ancho;
  b.height = d.alto;
  const cb = b.getContext("2d")!;
  cb.translate(e.volteoH ? d.ancho : 0, e.volteoV ? d.alto : 0);
  cb.scale(e.volteoH ? -1 : 1, e.volteoV ? -1 : 1);
  cb.drawImage(a, 0, 0);
  return b;
}

const limitar = (v: number, mn: number, mx: number) => Math.min(mx, Math.max(mn, v));

const Num = ({ icono, etiqueta, valor, min, max, onChange, deshabilitado }: { icono: NombreIcono; etiqueta: string; valor: number; min: number; max: number; onChange: (n: number) => void; deshabilitado?: boolean }) => (
  <label className="flex items-center gap-2 text-[color:var(--texto)]" title={etiqueta}>
    <Icono nombre={icono} />
    <span className="sr-only">{etiqueta}</span>
    <input type="number" aria-label={etiqueta} className="campo w-20 px-2 py-1" min={min} max={max} value={valor} disabled={deshabilitado} onChange={(e) => onChange(limitar(Math.round(Number(e.target.value) || min), min, max))} />
  </label>
);
const Deslizador = ({ icono, etiqueta, valor, min, max, paso, onChange }: { icono: NombreIcono; etiqueta: string; valor: number; min: number; max: number; paso: number; onChange: (n: number) => void }) => (
  <label className="flex items-center gap-2 text-[color:var(--texto)]" title={etiqueta}>
    <Icono nombre={icono} />
    <span className="sr-only">{etiqueta}</span>
    <input type="range" aria-label={etiqueta} className="w-full accent-[color:var(--acento)]" min={min} max={max} step={paso} value={valor} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(min < 0 ? 0 : 1)} />
  </label>
);


export default function EditorFoto({ casoId, foto, onCerrar, onGuardado }: { casoId: string; foto: ArchivoMeta; onCerrar: () => void; onGuardado: () => void }) {
  const [ed, setEd] = useState<EdicionFoto>(() => ({ ...EDICION_INICIAL, ...(foto.edicion ?? {}) }));
  // El editor solo se monta al abrirlo (en el navegador): se pueden leer las preferencias directamente.
  const [gr, setGr] = useState<Cuadricula>(leerPrefs);
  const [modo, setModo] = useState<"imagen" | "cuadricula" | "area">("imagen");
  const [banda, setBanda] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const escenario = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ x: number; y: number } | null>(null);
  // Arrastre sobre el mapa: mover el marco o cambiar su tamaño desde una esquina (la opuesta queda fija).
  const mapaArrastre = useRef<{ tipo: "mover"; dx: number; dy: number } | { tipo: "tamano"; ax: number; ay: number; sx: 1 | -1; sy: 1 | -1 } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_LS, JSON.stringify(gr));
    } catch {
      /* sin almacenamiento: las preferencias de la cuadrícula no se recuerdan */
    }
  }, [gr]);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setError("No se pudo cargar la fotografía.");
    i.src = `/api/casos/${casoId}/archivos/${foto.id}`;
  }, [casoId, foto.id]);

  const prep = useMemo(() => (img ? prepararLienzo(img, ed) : null), [img, ed.giro, ed.volteoH, ed.volteoV]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambiar = useCallback(
    (p: Partial<EdicionFoto>) =>
      setEd((e) => {
        const n = { ...e, ...p };
        if (!prep) return n;
        return { ...n, ...centroValido(prep.width, prep.height, n) };
      }),
    [prep],
  );

  // Dibujo del recorte (lo mismo que se insertará) y del mapa de ubicación.
  useEffect(() => {
    if (!prep || !lienzo.current) return;
    const v = ventanaDeRecorte(prep.width, prep.height, ed);
    const c = lienzo.current;
    c.getContext("2d")!.drawImage(prep, v.x, v.y, v.w, v.h, 0, 0, c.width, c.height);
    const m = mini.current;
    if (m) {
      const k = m.width / prep.width;
      m.height = Math.round(prep.height * k);
      const cm = m.getContext("2d")!;
      cm.drawImage(prep, 0, 0, m.width, m.height);
      cm.lineWidth = 3;
      cm.strokeStyle = "#000";
      cm.strokeRect(v.x * k, v.y * k, v.w * k, v.h * k);
      cm.lineWidth = 1.5;
      cm.strokeStyle = "#fff";
      cm.strokeRect(v.x * k, v.y * k, v.w * k, v.h * k);
      // Asas de las esquinas: se arrastran para ampliar o reducir el marco.
      for (const [hx, hy] of [[v.x, v.y], [v.x + v.w, v.y], [v.x, v.y + v.h], [v.x + v.w, v.y + v.h]]) {
        cm.fillStyle = "#fff";
        cm.strokeStyle = "#000";
        cm.lineWidth = 1.5;
        cm.fillRect(hx * k - 5, hy * k - 5, 10, 10);
        cm.strokeRect(hx * k - 5, hy * k - 5, 10, 10);
      }
    }
  }, [prep, ed]);

  const zoomPor = useCallback((f: number) => cambiar({ zoom: limitar(ed.zoom * f, 1, ZOOM_MAX) }), [cambiar, ed.zoom]);

  // La rueda amplía/reduce; debe ser un oyente no pasivo para poder evitar el desplazamiento de la página.
  useEffect(() => {
    const el = escenario.current;
    if (!el) return;
    const rueda = (ev: WheelEvent) => {
      ev.preventDefault();
      zoomPor(Math.exp(-ev.deltaY * 0.0015));
    };
    el.addEventListener("wheel", rueda, { passive: false });
    return () => el.removeEventListener("wheel", rueda);
  }, [zoomPor]);

  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  function mover(dx: number, dy: number) {
    if (!prep || !escenario.current) return;
    const ancho = escenario.current.clientWidth;
    const alto = escenario.current.clientHeight;
    if (modo === "cuadricula") {
      setGr((g) => ({ ...g, ox: (g.ox + dx / ancho + 1) % 1, oy: (g.oy + dy / alto + 1) % 1 }));
      return;
    }
    const v = ventanaDeRecorte(prep.width, prep.height, ed);
    cambiar({ cx: ed.cx - (dx * (v.w / ancho)) / prep.width, cy: ed.cy - (dy * (v.h / alto)) / prep.height });
  }

  /** Posición del puntero sobre el mapa, en píxeles de la imagen girada. */
  function enMapa(e: React.PointerEvent<HTMLCanvasElement>) {
    const m = mini.current!;
    const r = m.getBoundingClientRect();
    const k = m.width / prep!.width;
    return { px: ((e.clientX - r.left) * (m.width / r.width)) / k, py: ((e.clientY - r.top) * (m.height / r.height)) / k, k: k * (r.width / m.width) };
  }
  function mapaAbajo(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!prep) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { px, py, k } = enMapa(e);
    const v = ventanaDeRecorte(prep.width, prep.height, ed);
    const radio = 12 / k;
    const esquinas: [number, number, 1 | -1, 1 | -1][] = [
      [v.x, v.y, -1, -1],
      [v.x + v.w, v.y, 1, -1],
      [v.x, v.y + v.h, -1, 1],
      [v.x + v.w, v.y + v.h, 1, 1],
    ];
    const e1 = esquinas.find(([x, y]) => Math.hypot(px - x, py - y) <= radio);
    if (e1) {
      // La esquina opuesta queda fija.
      const [, , sx, sy] = e1;
      mapaArrastre.current = { tipo: "tamano", ax: sx === 1 ? v.x : v.x + v.w, ay: sy === 1 ? v.y : v.y + v.h, sx, sy };
      return;
    }
    const dentro = px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h;
    if (!dentro) cambiar({ cx: px / prep.width, cy: py / prep.height });
    mapaArrastre.current = { tipo: "mover", dx: dentro ? px - (v.x + v.w / 2) : 0, dy: dentro ? py - (v.y + v.h / 2) : 0 };
  }
  function mapaMueve(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!prep) return;
    const { px, py } = enMapa(e);
    const a = mapaArrastre.current;
    if (!a) {
      // Cursor según lo que hay bajo el puntero.
      const v = ventanaDeRecorte(prep.width, prep.height, ed);
      const { k } = enMapa(e);
      const cerca = [[v.x, v.y], [v.x + v.w, v.y + v.h], [v.x + v.w, v.y], [v.x, v.y + v.h]].some(([x, y]) => Math.hypot(px - x, py - y) <= 12 / k);
      e.currentTarget.style.cursor = cerca ? "nwse-resize" : px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h ? "move" : "crosshair";
      return;
    }
    if (a.tipo === "mover") {
      cambiar({ cx: (px - a.dx) / prep.width, cy: (py - a.dy) / prep.height });
      return;
    }
    const base = ventanaBase(prep.width, prep.height);
    const w = limitar(Math.max(Math.abs(px - a.ax), Math.abs(py - a.ay) * PROPORCION_FOTO), base.w / ZOOM_MAX, base.w);
    const h = w / PROPORCION_FOTO;
    cambiar({ zoom: base.w / w, cx: (a.ax + (a.sx * w) / 2) / prep.width, cy: (a.ay + (a.sy * h) / 2) / prep.height });
  }

  async function guardar(insertar = false) {
    setGuardando(true);
    setError(null);
    const cuerpo = { ...ed, ...(insertar ? { incluir: true } : {}), leyenda: ed.leyenda?.trim() || undefined };
    const r = await fetch(`/api/casos/${casoId}/archivos/${foto.id}/edicion`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    setGuardando(false);
    if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar");
    onGuardado();
  }

  const filas = gr.cuadradas ? Math.max(1, Math.round(gr.cols / PROPORCION_FOTO)) : gr.filas;
  const color = COLORES[gr.color];
  const L = (k: string, x1: number, y1: number, x2: number, y2: number) => <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />;
  const lineas: React.ReactNode[] = [];
  for (let i = -1; i <= gr.cols; i++) {
    const x = (gr.ox + i / gr.cols) * 100;
    lineas.push(L(`c${i}`, x, 0, x, 100));
  }
  for (let j = -1; j <= filas; j++) {
    const y = (gr.oy + j / filas) * 100;
    lineas.push(L(`f${j}`, 0, y, 100, y));
  }
  if (gr.diagonales)
    for (let i = -1; i <= gr.cols; i++)
      for (let j = -1; j <= filas; j++) {
        const x1 = (gr.ox + i / gr.cols) * 100;
        const y1 = (gr.oy + j / filas) * 100;
        const x2 = x1 + 100 / gr.cols;
        const y2 = y1 + 100 / filas;
        lineas.push(L(`d${i}_${j}`, x1, y1, x2, y2), L(`e${i}_${j}`, x2, y1, x1, y2));
      }

  return (
    <VentanaModal
      etiqueta={`Editar fotografía ${foto.nombre}`}
      titulo={`${foto.recinto ? `${foto.recinto} · ` : ""}${foto.nombre}`}
      onCerrar={onCerrar}
      ancho="max-w-6xl"
      nivel={60}
      acciones={
        <>
          <button type="button" className="btn !px-3 !py-1.5 text-sm" disabled={guardando} onClick={() => void guardar(true)} title="Guarda el recorte, marca la foto para el informe y actualiza el documento">
            <Icono nombre="check" tam={18} /> Insertar en el informe
          </button>
          <BotonIcono icono="check" etiqueta={ed.incluir ? "Va al informe (clic para quitarla)" : "Marcar para el informe"} activo={!!ed.incluir} onClick={() => setEd((e) => ({ ...e, incluir: !e.incluir }))} />
          <BotonIcono icono="reiniciar" etiqueta="Restablecer todo" onClick={() => setEd({ ...EDICION_INICIAL, incluir: ed.incluir })} />
          <BotonIcono icono="guardar" etiqueta={guardando ? "Guardando…" : "Guardar edición"} deshabilitado={guardando} onClick={() => void guardar()} />
        </>
      }
    >
      {({ maximizada }) => (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {error && <p role="alert" className="aviso aviso-error">{error}</p>}
        {guardando && <p role="status" className="aviso aviso-ok">Guardando y actualizando el informe, el anexo y el PDF con tu recorte… puede tardar unos segundos.</p>}

        <div className={`grid gap-3 ${maximizada ? "lg:grid-cols-[13rem_1fr_13rem]" : "lg:grid-cols-[15rem_1fr_15rem]"}`}>
          {/* Izquierda: encuadre y ajustes de imagen */}
          <div className="space-y-3 rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel-2)] p-3">
            <div className="flex flex-wrap gap-2">
              <BotonIcono icono="zoomMas" etiqueta="Ampliar" onClick={() => zoomPor(1.25)} deshabilitado={ed.zoom >= ZOOM_MAX} />
              <BotonIcono icono="zoomMenos" etiqueta="Reducir" onClick={() => zoomPor(0.8)} deshabilitado={ed.zoom <= 1} />
              <BotonIcono icono="ajustar" etiqueta="Ajustar al marco" onClick={() => cambiar({ zoom: 1, cx: 0.5, cy: 0.5 })} />
              <BotonIcono icono="rotarIzq" etiqueta="Girar a la izquierda" onClick={() => cambiar({ giro: girar(ed.giro, -1), cx: 0.5, cy: 0.5 })} />
              <BotonIcono icono="rotarDer" etiqueta="Girar a la derecha" onClick={() => cambiar({ giro: girar(ed.giro, 1), cx: 0.5, cy: 0.5 })} />
              <BotonIcono icono="volteoH" etiqueta="Voltear izquierda/derecha" activo={ed.volteoH} onClick={() => cambiar({ volteoH: !ed.volteoH })} />
              <BotonIcono icono="volteoV" etiqueta="Voltear arriba/abajo" activo={ed.volteoV} onClick={() => cambiar({ volteoV: !ed.volteoV })} />
            </div>
            <div>
              <canvas
                ref={mini}
                width={480}
                height={360}
                className="mx-auto block w-full touch-none rounded border border-[color:var(--borde)]"
                aria-label="Mapa de la fotografía: arrastra el marco para moverlo y sus esquinas para ampliarlo o reducirlo"
                role="img"
                onPointerDown={mapaAbajo}
                onPointerMove={mapaMueve}
                onPointerUp={() => (mapaArrastre.current = null)}
                onPointerCancel={() => (mapaArrastre.current = null)}
              />
              <p className="mt-1 text-center text-xs text-[color:var(--suave)]">Arrastra el marco para moverlo y sus esquinas para ampliar o reducir.</p>
            </div>
            <Deslizador icono="zoomMas" etiqueta="Ampliación" valor={ed.zoom} min={1} max={ZOOM_MAX} paso={0.05} onChange={(n) => cambiar({ zoom: n })} />
            <Deslizador icono="sol" etiqueta="Brillo" valor={ed.brillo} min={-100} max={100} paso={1} onChange={(n) => cambiar({ brillo: n })} />
            <Deslizador icono="contraste" etiqueta="Contraste" valor={ed.contraste} min={-100} max={100} paso={1} onChange={(n) => cambiar({ contraste: n })} />
            <Deslizador icono="gota" etiqueta="Saturación" valor={ed.saturacion} min={-100} max={100} paso={1} onChange={(n) => cambiar({ saturacion: n })} />
            <label className="flex items-center gap-2 text-[color:var(--texto)]" title="Leyenda de una línea bajo la foto">
              <Icono nombre="texto" />
              <span className="sr-only">Leyenda de la fotografía</span>
              <input className="campo px-2 py-1 text-sm" aria-label="Leyenda de la fotografía" maxLength={LEYENDA_FOTO_MAX} placeholder="Leyenda (opcional, una línea)" value={ed.leyenda ?? ""} onChange={(e) => setEd((x) => ({ ...x, leyenda: e.target.value }))} />
            </label>
          </div>

          {/* Centro: el recorte tal como se insertará (8,66 × 6,70 cm) */}
          <div className="space-y-2">
            <div
              ref={escenario}
              className={`relative mx-auto w-full touch-none select-none overflow-hidden rounded-lg border border-[color:var(--borde)] bg-black ${maximizada ? "max-w-none" : "max-w-[640px]"}`}
              style={{ aspectRatio: `${PROPORCION_FOTO}`, cursor: modo === "area" ? "crosshair" : modo === "cuadricula" ? "move" : "grab" }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const r = e.currentTarget.getBoundingClientRect();
                if (modo === "area") setBanda({ x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top });
                else arrastre.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerMove={(e) => {
                if (modo === "area") {
                  const r = e.currentTarget.getBoundingClientRect();
                  const x1 = e.clientX - r.left;
                  const y1 = e.clientY - r.top;
                  setBanda((b) => (b ? { ...b, x1, y1 } : b));
                  return;
                }
                if (!arrastre.current) return;
                mover(e.clientX - arrastre.current.x, e.clientY - arrastre.current.y);
                arrastre.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerUp={() => {
                arrastre.current = null;
                if (!banda || !prep || !escenario.current) return setBanda(null);
                // El rectángulo dibujado pasa a ser el nuevo encuadre (ampliado a la proporción del marco).
                const W = escenario.current.clientWidth;
                const H = escenario.current.clientHeight;
                const v = ventanaDeRecorte(prep.width, prep.height, ed);
                const x = Math.min(banda.x0, banda.x1);
                const y = Math.min(banda.y0, banda.y1);
                const w = Math.abs(banda.x1 - banda.x0);
                const h = Math.abs(banda.y1 - banda.y0);
                setBanda(null);
                if (w < 8 || h < 8) return;
                cambiar(encuadreDeRectangulo(prep.width, prep.height, { x: v.x + (x / W) * v.w, y: v.y + (y / H) * v.h, w: (w / W) * v.w, h: (h / H) * v.h }));
              }}
              onPointerCancel={() => {
                arrastre.current = null;
                setBanda(null);
              }}
              role="img"
              aria-label="Vista del recorte. Arrastra para mover la imagen; la rueda amplía y reduce; en el modo selección, dibuja un rectángulo para ampliar esa zona."
            >
              <canvas ref={lienzo} width={936} height={780} className="block h-full w-full" style={{ filter: `brightness(${1 + ed.brillo / 100}) contrast(${1 + ed.contraste / 100}) saturate(${1 + ed.saturacion / 100})` }} />
              {gr.visible && (
                <>
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" stroke={color} strokeOpacity={gr.opacidad} strokeWidth={gr.grosor} fill="none" aria-hidden="true">
                    {lineas}
                  </svg>
                  {gr.etiquetas &&
                    Array.from({ length: gr.cols * filas }, (_, n) => {
                      const c = n % gr.cols;
                      const f = Math.floor(n / gr.cols);
                      return (
                        <span key={n} className="pointer-events-none absolute text-[10px] leading-none" style={{ left: `${((gr.ox + c / gr.cols) % 1) * 100 + 0.5}%`, top: `${((gr.oy + f / filas) % 1) * 100 + 0.5}%`, color, opacity: gr.opacidad, textShadow: gr.color === "negro" ? "0 0 2px #fff" : "0 0 2px #000" }}>
                          {String.fromCharCode(65 + (c % 26))}{f + 1}
                        </span>
                      );
                    })}
                </>
              )}
              {banda && (
                <div className="pointer-events-none absolute" style={{ left: Math.min(banda.x0, banda.x1), top: Math.min(banda.y0, banda.y1), width: Math.abs(banda.x1 - banda.x0), height: Math.abs(banda.y1 - banda.y0), border: "1px dashed #fff", outline: "1px solid #000", background: "rgba(255,255,255,.12)" }} aria-hidden="true" />
              )}
              {!img && !error && <span className="absolute inset-0 grid place-items-center text-sm text-white">Cargando fotografía…</span>}
            </div>
            <p className="text-center text-xs text-[color:var(--suave)]">Marco de {FOTO_TAMANO_TEXTO}, tal como irá en el informe. Arrastra para encuadrar; la rueda amplía; con el icono de selección dibuja un rectángulo sobre el detalle que quieres.</p>
          </div>

          {/* Derecha: cuadrícula de guía y mapa */}
          <div className="space-y-3 rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel-2)] p-3">
            <div className="flex flex-wrap gap-2">
              <BotonIcono icono="seleccion" etiqueta="Seleccionar un área para ampliarla (dibuja un rectángulo)" activo={modo === "area"} onClick={() => setModo((m) => (m === "area" ? "imagen" : "area"))} />
              <BotonIcono icono="cuadricula" etiqueta="Mostrar cuadrícula" activo={gr.visible} onClick={() => setGr((g) => ({ ...g, visible: !g.visible }))} />
              <BotonIcono icono="mano" etiqueta="Mover la cuadrícula (en vez de la imagen)" activo={modo === "cuadricula"} onClick={() => setModo((m) => (m === "cuadricula" ? "imagen" : "cuadricula"))} deshabilitado={!gr.visible} />
              <BotonIcono icono="cuadrado" etiqueta="Celdas cuadradas" activo={gr.cuadradas} onClick={() => setGr((g) => ({ ...g, cuadradas: !g.cuadradas }))} />
              <BotonIcono icono="diagonal" etiqueta="Líneas diagonales" activo={gr.diagonales} onClick={() => setGr((g) => ({ ...g, diagonales: !g.diagonales }))} />
              <BotonIcono icono="etiqueta" etiqueta="Etiquetar celdas" activo={gr.etiquetas} onClick={() => setGr((g) => ({ ...g, etiquetas: !g.etiquetas }))} />
              <BotonIcono icono="reiniciar" etiqueta="Centrar la cuadrícula" onClick={() => setGr((g) => ({ ...g, ox: 0, oy: 0 }))} />
            </div>
            <Num icono="columnas" etiqueta="Número de columnas" valor={gr.cols} min={1} max={24} onChange={(n) => setGr((g) => ({ ...g, cols: n }))} />
            <Num icono="filas" etiqueta="Número de filas" valor={filas} min={1} max={24} deshabilitado={gr.cuadradas} onChange={(n) => setGr((g) => ({ ...g, filas: n }))} />
            <div className="flex items-center gap-2" role="group" aria-label="Color de la cuadrícula">
              {(["negro", "blanco", "gris"] as const).map((c) => (
                <button key={c} type="button" aria-label={`Líneas ${c === "negro" ? "negras" : c === "blanco" ? "blancas" : "grises"}`} title={`Líneas ${c === "negro" ? "negras" : c === "blanco" ? "blancas" : "grises"}`} aria-pressed={gr.color === c} onClick={() => setGr((g) => ({ ...g, color: c }))} className="h-8 w-8 rounded-full border-2 border-[color:var(--borde)] aria-pressed:border-[color:var(--acento)] aria-pressed:ring-2 aria-pressed:ring-[color:var(--acento)]" style={{ background: COLORES[c] }} />
              ))}
              <BotonIcono icono="grosor" etiqueta={gr.grosor === 0.5 ? "Línea ultrafina (clic para 1 px)" : "Línea de 1 px (clic para ultrafina)"} activo={gr.grosor === 1} onClick={() => setGr((g) => ({ ...g, grosor: g.grosor === 0.5 ? 1 : 0.5 }))} />
            </div>
            <Deslizador icono="opacidad" etiqueta="Opacidad de la cuadrícula" valor={gr.opacidad} min={0.1} max={1} paso={0.05} onChange={(n) => setGr((g) => ({ ...g, opacidad: n }))} />
          </div>
        </div>
      </div>
      )}
    </VentanaModal>
  );
}
