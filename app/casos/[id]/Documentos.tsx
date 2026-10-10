"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchivoMeta, Caso } from "@/lib/caso/repositorio";
import { ETIQUETA_TIPO } from "@/lib/caso/clasificar";
import { useFlujo } from "@/components/useFlujo";
import PanelTraza from "@/components/PanelTraza";
import { useAccionesMenu } from "@/components/Shell";
import TituloAyuda from "@/components/Ayuda";

type Procesado = { alertas: string[]; archivosLeidos: string[]; partidas: number };
const LOTE = 15;
const nombreCorto = (n: string) => n.split(/[/\\]/).pop() ?? n;
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function Documentos({ caso, archivos }: { caso: Caso; archivos: ArchivoMeta[] }) {
  const router = useRouter();
  const carpeta = useRef<HTMLInputElement>(null);
  const sueltos = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const cambiar = useRef<HTMLInputElement>(null);
  const reemplazando = useRef<string | null>(null);
  const [avisoReemplazo, setAvisoReemplazo] = useState<string | null>(null);
  const proc = useFlujo<Procesado>(`/api/casos/${caso.id}/procesar`);

  async function subir(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const files = Array.from(lista);
    setErrorSubida(null);
    for (let i = 0; i < files.length; i += LOTE) {
      const lote = files.slice(i, i + LOTE);
      setSubiendo(`Subiendo ${Math.min(i + LOTE, files.length)} de ${files.length}…`);
      const f = new FormData();
      for (const a of lote) {
        f.append("archivos", a);
        f.append("rutas", (a as File & { webkitRelativePath?: string }).webkitRelativePath || a.name);
      }
      const r = await fetch(`/api/casos/${caso.id}/archivos`, { method: "POST", body: f });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErrorSubida(j.error ?? `Error ${r.status} al subir`);
        break;
      }
    }
    setSubiendo(null);
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

  const fotos = archivos.filter((a) => a.tipo === "foto");
  const docs = archivos.filter((a) => a.tipo !== "foto" && a.tipo !== "salida" && a.tipo !== "meteo_png");
  const porRecinto = new Map<string, number>();
  for (const f of fotos) porRecinto.set(f.recinto ?? "Sin recinto", (porRecinto.get(f.recinto ?? "Sin recinto") ?? 0) + 1);
  const alertas = proc.resultado?.alertas ?? caso.datos.alertas ?? [];

  // Las acciones están en el menú lateral; la pantalla central muestra el resultado y se edita desde ella.
  useAccionesMenu([
    { id: "carpeta", etiqueta: "Subir carpeta del caso", icono: "carpeta", deshabilitado: !!subiendo, onClick: () => carpeta.current?.click() },
    { id: "archivos", etiqueta: "Subir archivos", icono: "subir", deshabilitado: !!subiendo, onClick: () => sueltos.current?.click() },
    { id: "leer", etiqueta: proc.cargando ? "Leyendo…" : "Leer documentos", icono: "ejecutar", primaria: true, deshabilitado: proc.cargando || docs.length === 0, onClick: () => void proc.ejecutar() },
  ]);

  return (
    <section className="space-y-4">
      <div className="panel space-y-3 p-5">
        <TituloAyuda titulo="Antecedentes del siniestro" nivel={2}>
          <p>
          Sube la carpeta completa del caso (o archivos sueltos) con las acciones «Subir carpeta del caso» y «Subir archivos» del menú lateral: acta de inspección, provisión, presupuesto del contratista (Excel o PDF), mandato y fotografías por recinto.
          Las carpetas de fotos se reconocen por su nombre (p. ej. «Living», «Dormitorio 1», «Cubierta»).
        </p>
        </TituloAyuda>
        <div className="hidden">
          <input ref={carpeta} type="file" multiple className="hidden" onChange={(e) => subir(e.target.files)} {...({ webkitdirectory: "" } as object)} />
          <input ref={sueltos} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" onChange={(e) => subir(e.target.files)} />
        </div>
        {subiendo && <p role="status" className="aviso aviso-ok">{subiendo}</p>}
        {errorSubida && <p role="alert" className="aviso aviso-error">{errorSubida}</p>}
        {avisoReemplazo && <p role="status" className="aviso aviso-ok">{avisoReemplazo}</p>}
      </div>

      {(docs.length > 0 || fotos.length > 0) && (
        <div className="panel p-5">
          <h3 className="mb-2 font-semibold">Archivos cargados</h3>
          <input ref={cambiar} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" onChange={(e) => { void reemplazar(e.target.files); e.target.value = ""; }} />
          <ul className="divide-y divide-[var(--borde)] text-sm">
            {docs.map((d) => (
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
          {fotos.length > 0 && (
            <p className="mt-3 text-sm">
              <strong>{fotos.length} fotografías:</strong>{" "}
              {[...porRecinto.entries()].map(([r, n]) => `${r} (${n})`).join(" · ")}
            </p>
          )}
        </div>
      )}

      <div className="panel space-y-3 p-5">
        <TituloAyuda titulo="Lectura de los documentos" nivel={3}>
          <p>La acción «Leer documentos» del menú lateral extrae acta, provisión y presupuesto, calcula la UF de la fecha del siniestro y deja el caso listo para ajustar. Es seguro repetirla.</p>
        </TituloAyuda>
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
      </div>
    </section>
  );
}
