"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchivoMeta, Caso } from "@/lib/caso/repositorio";
import { ETIQUETA_TIPO, type Ranura } from "@/lib/caso/clasificar";
import { useFlujo } from "@/components/useFlujo";
import PanelTraza from "@/components/PanelTraza";
import { useAccionesMenu } from "@/components/Shell";
import { Icono } from "@/components/Iconos";

type Procesado = { alertas: string[]; archivosLeidos: string[]; partidas: number };
const LOTE = 15;
const nombreCorto = (n: string) => n.split(/[/\\]/).pop() ?? n;
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const ACEPTA_DOC = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff";
const ACEPTA_FOTOS = ".jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.zip";

const TIPOS_RANURA: Record<Ranura, string[]> = {
  inspeccion: ["acta", "provision", "borrador", "mandato", "informe_tecnico", "correspondencia", "otro"],
  presupuesto: ["presupuesto_xlsx", "presupuesto_pdf", "presupuesto_otro"],
  fotos: ["foto"],
};

export default function Documentos({ caso, archivos }: { caso: Caso; archivos: ArchivoMeta[] }) {
  const router = useRouter();
  const entradas = {
    inspeccion: useRef<HTMLInputElement>(null),
    presupuesto: useRef<HTMLInputElement>(null),
    fotos: useRef<HTMLInputElement>(null),
    carpeta: useRef<HTMLInputElement>(null),
  };
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const cambiar = useRef<HTMLInputElement>(null);
  const reemplazando = useRef<string | null>(null);
  const [avisoReemplazo, setAvisoReemplazo] = useState<string | null>(null);
  const [omitidos, setOmitidos] = useState<string[]>([]);
  const proc = useFlujo<Procesado>(`/api/casos/${caso.id}/procesar`);

  async function subir(ranura: Ranura, lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const files = Array.from(lista);
    setErrorSubida(null);
    setOmitidos([]);
    const rechazados: string[] = [];
    for (let i = 0; i < files.length; i += LOTE) {
      const lote = files.slice(i, i + LOTE);
      setSubiendo(`Subiendo ${Math.min(i + LOTE, files.length)} de ${files.length}…`);
      const f = new FormData();
      f.append("ranura", ranura);
      for (const a of lote) {
        f.append("archivos", a);
        f.append("rutas", (a as File & { webkitRelativePath?: string }).webkitRelativePath || a.name);
      }
      const r = await fetch(`/api/casos/${caso.id}/archivos`, { method: "POST", body: f });
      const j = (await r.json().catch(() => ({}))) as { error?: string; rechazados?: { nombre: string; motivo: string }[] };
      if (!r.ok) {
        setErrorSubida(j.error ?? `Error ${r.status} al subir`);
        break;
      }
      rechazados.push(...(j.rechazados ?? []).map((x) => `${nombreCorto(x.nombre)}: ${x.motivo}`));
    }
    setSubiendo(null);
    setOmitidos(rechazados.slice(0, 8));
    router.refresh();
  }

  async function quitar(d: ArchivoMeta) {
    if (!window.confirm(`¿Quitar «${nombreCorto(d.nombre)}» del caso?`)) return;
    await fetch(`/api/casos/${caso.id}/archivos/${d.id}`, { method: "DELETE" });
    router.refresh();
  }

  /** Cambia un archivo ya cargado por otro (p. ej. una versión corregida del presupuesto) sin tener que quitarlo y volver a subir todo. */
  async function reemplazar(lista: FileList | null) {
    const id = reemplazando.current;
    reemplazando.current = null;
    const f = lista?.[0];
    if (!id || !f) return;
    setErrorSubida(null);
    setAvisoReemplazo(null);
    setSubiendo(`Cargando «${f.name}»…`);
    const fd = new FormData();
    fd.append("archivo", f);
    const r = await fetch(`/api/casos/${caso.id}/archivos/${id}`, { method: "PUT", body: fd });
    setSubiendo(null);
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      return setErrorSubida(j.error ?? `Error ${r.status} al cargar`);
    }
    setAvisoReemplazo(`«${f.name}» reemplazó al archivo anterior. Pulsa «Leer documentos» para que se vuelva a leer.`);
    router.refresh();
  }

  const deRanura = (r: Ranura) => archivos.filter((a) => TIPOS_RANURA[r].includes(a.tipo));
  const inspeccion = deRanura("inspeccion");
  const presupuesto = deRanura("presupuesto");
  const fotos = deRanura("fotos");
  const porRecinto = new Map<string, number>();
  for (const f of fotos) porRecinto.set(f.recinto ?? "Sin recinto", (porRecinto.get(f.recinto ?? "Sin recinto") ?? 0) + 1);
  const alertas = proc.resultado?.alertas ?? caso.datos.alertas ?? [];
  const puedeLeer = inspeccion.length > 0 || presupuesto.length > 0;

  // Las acciones están en el menú lateral; cada tarjeta tiene además su propio botón.
  useAccionesMenu([
    { id: "sube-inspeccion", etiqueta: "Subir inspección", icono: "subir", deshabilitado: !!subiendo, onClick: () => entradas.inspeccion.current?.click() },
    { id: "sube-presupuesto", etiqueta: "Subir presupuesto", icono: "subir", deshabilitado: !!subiendo, onClick: () => entradas.presupuesto.current?.click() },
    { id: "sube-fotos", etiqueta: "Subir fotos", icono: "imagen", deshabilitado: !!subiendo, onClick: () => entradas.fotos.current?.click() },
    { id: "sube-carpeta", etiqueta: "Subir carpeta de fotos", icono: "carpeta", deshabilitado: !!subiendo, onClick: () => entradas.carpeta.current?.click() },
    { id: "leer", etiqueta: proc.cargando ? "Leyendo…" : "Leer documentos", icono: "ejecutar", primaria: true, deshabilitado: proc.cargando || !puedeLeer, onClick: () => void proc.ejecutar() },
  ]);

  const lista = (items: ArchivoMeta[]) => (
    <ul className="divide-y divide-[var(--borde)] text-sm">
      {items.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
          <span className="min-w-0 flex-1 truncate" title={d.nombre}>
            {nombreCorto(d.nombre)} <span className="texto-suave text-xs">· {kb(d.tamano)}</span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="insignia">{ETIQUETA_TIPO[d.tipo as keyof typeof ETIQUETA_TIPO] ?? d.tipo}</span>
            <a className="btn btn-sec !px-2 !py-0.5 text-xs" href={`/api/casos/${caso.id}/archivos/${d.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${nombreCorto(d.nombre)}`}>Abrir</a>
            <button type="button" className="btn btn-sec !px-2 !py-0.5 text-xs" disabled={!!subiendo} onClick={() => { reemplazando.current = d.id; cambiar.current?.click(); }} aria-label={`Cargar otro archivo en lugar de ${nombreCorto(d.nombre)}`}>Cargar otro</button>
            <button type="button" className="btn btn-sec !px-2 !py-0.5 text-xs" onClick={() => quitar(d)} aria-label={`Quitar ${nombreCorto(d.nombre)}`}>Quitar</button>
          </span>
        </li>
      ))}
    </ul>
  );

  const tarjeta = (r: "inspeccion" | "presupuesto", titulo: string, detalle: string, boton: string, items: ArchivoMeta[]) => (
    <div className="panel space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{titulo}</h3>
          <p className="texto-suave text-sm">{detalle}</p>
        </div>
        <button type="button" className="btn" disabled={!!subiendo} onClick={() => entradas[r].current?.click()}>
          <Icono nombre="subir" /> {boton}
        </button>
      </div>
      {items.length === 0 ? <p className="texto-suave text-sm">Aún no hay archivos.</p> : lista(items)}
    </div>
  );

  return (
    <section className="space-y-4">
      <div className="hidden">
        <input ref={entradas.inspeccion} type="file" multiple className="hidden" accept={ACEPTA_DOC} onChange={(e) => { void subir("inspeccion", e.target.files); e.target.value = ""; }} />
        <input ref={entradas.presupuesto} type="file" multiple className="hidden" accept={ACEPTA_DOC} onChange={(e) => { void subir("presupuesto", e.target.files); e.target.value = ""; }} />
        <input ref={entradas.fotos} type="file" multiple className="hidden" accept={ACEPTA_FOTOS} onChange={(e) => { void subir("fotos", e.target.files); e.target.value = ""; }} />
        <input ref={entradas.carpeta} type="file" multiple className="hidden" onChange={(e) => { void subir("fotos", e.target.files); e.target.value = ""; }} {...({ webkitdirectory: "" } as object)} />
        <input ref={cambiar} type="file" className="hidden" accept={`${ACEPTA_DOC},.zip`} onChange={(e) => { void reemplazar(e.target.files); e.target.value = ""; }} />
      </div>
      {subiendo && <p role="status" className="aviso aviso-ok">{subiendo}</p>}
      {errorSubida && <p role="alert" className="aviso aviso-error">{errorSubida}</p>}
      {avisoReemplazo && <p role="status" className="aviso aviso-ok">{avisoReemplazo}</p>}
      {omitidos.length > 0 && (
        <ul role="status" className="aviso aviso-alerta list-disc space-y-0.5 pl-6 text-sm">
          {omitidos.map((o, i) => (<li key={i}>No se cargó {o}</li>))}
        </ul>
      )}

      {tarjeta("inspeccion", "1 · Inspección", "Informe de la inspección en cualquier formato: PDF, Word, Excel, imagen o foto del documento.", "Subir inspección", inspeccion)}
      {tarjeta("presupuesto", "2 · Presupuesto", "Presupuesto del contratista en cualquier formato: Excel, PDF (con texto o escaneado), Word o imagen. Se lleva a Excel conservando el orden, los textos y los valores.", "Subir presupuesto", presupuesto)}
      <div className="panel space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">3 · Fotos</h3>
            <p className="texto-suave text-sm">Imágenes por estancia: elige archivos, una carpeta (cada subcarpeta es una estancia) o un ZIP.</p>
          </div>
          <span className="flex flex-wrap gap-2">
            <button type="button" className="btn" disabled={!!subiendo} onClick={() => entradas.fotos.current?.click()}><Icono nombre="imagen" /> Subir fotos</button>
            <button type="button" className="btn btn-sec" disabled={!!subiendo} onClick={() => entradas.carpeta.current?.click()}><Icono nombre="carpeta" /> Subir carpeta</button>
          </span>
        </div>
        {fotos.length === 0 ? (
          <p className="texto-suave text-sm">Aún no hay fotografías.</p>
        ) : (
          <p className="text-sm">
            <strong>{fotos.length} fotografías:</strong> {[...porRecinto.entries()].map(([rc, n]) => `${rc} (${n})`).join(" · ")}
          </p>
        )}
      </div>

      <div className="panel space-y-3 p-5">
        {proc.error && <p role="alert" className="aviso aviso-error">{proc.error}</p>}
        <PanelTraza eventos={proc.eventos} cargando={proc.cargando} titulo="Qué está leyendo" />
        {proc.resultado && (
          <p role="status" className="aviso aviso-ok">
            Leídos: {proc.resultado.archivosLeidos.join(", ") || "ninguno"}
            {proc.resultado.partidas ? ` · ${proc.resultado.partidas} partidas de reclamación` : " · sin presupuesto: se hará pérdida determinada"}
          </p>
        )}
        {alertas.length > 0 && (
          <ul className="aviso aviso-alerta list-disc space-y-1 pl-6">
            {alertas.map((a, i) => (<li key={i}>{a}</li>))}
          </ul>
        )}
        {!proc.cargando && !proc.resultado && alertas.length === 0 && <p className="texto-suave text-sm">Con la inspección y el presupuesto cargados, usa «Leer documentos» del menú.</p>}
      </div>
    </section>
  );
}
