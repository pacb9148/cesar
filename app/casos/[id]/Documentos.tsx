"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchivoMeta, Caso } from "@/lib/caso/repositorio";
import { ETIQUETA_TIPO } from "@/lib/caso/clasificar";
import { useAccion } from "@/components/useAccion";

type Procesado = { alertas: string[]; archivosLeidos: string[]; partidas: number };
const LOTE = 15;

export default function Documentos({ caso, archivos }: { caso: Caso; archivos: ArchivoMeta[] }) {
  const router = useRouter();
  const carpeta = useRef<HTMLInputElement>(null);
  const sueltos = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const proc = useAccion<Procesado>(`/api/casos/${caso.id}/procesar`);

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

  async function quitar(id: string) {
    await fetch(`/api/casos/${caso.id}/archivos/${id}`, { method: "DELETE" });
    router.refresh();
  }

  const fotos = archivos.filter((a) => a.tipo === "foto");
  const docs = archivos.filter((a) => a.tipo !== "foto" && a.tipo !== "salida" && a.tipo !== "meteo_png");
  const porRecinto = new Map<string, number>();
  for (const f of fotos) porRecinto.set(f.recinto ?? "Sin recinto", (porRecinto.get(f.recinto ?? "Sin recinto") ?? 0) + 1);
  const alertas = proc.resultado?.alertas ?? caso.datos.alertas ?? [];

  return (
    <section className="space-y-4">
      <div className="panel space-y-3 p-5">
        <h2 className="text-lg font-semibold">Antecedentes del siniestro</h2>
        <p className="texto-suave text-sm">
          Sube la carpeta completa del caso (o archivos sueltos): acta de inspección, provisión, presupuesto del contratista (Excel o PDF), mandato y fotografías por recinto.
          Las carpetas de fotos se reconocen por su nombre (p. ej. «Living», «Dormitorio 1», «Cubierta»).
        </p>
        <div className="flex flex-wrap gap-2">
          <input ref={carpeta} type="file" multiple className="hidden" onChange={(e) => subir(e.target.files)} {...({ webkitdirectory: "" } as object)} />
          <input ref={sueltos} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" onChange={(e) => subir(e.target.files)} />
          <button className="btn" onClick={() => carpeta.current?.click()} disabled={!!subiendo}>Subir carpeta</button>
          <button className="btn btn-sec" onClick={() => sueltos.current?.click()} disabled={!!subiendo}>Subir archivos</button>
        </div>
        {subiendo && <p role="status" className="aviso aviso-ok">{subiendo}</p>}
        {errorSubida && <p role="alert" className="aviso aviso-error">{errorSubida}</p>}
      </div>

      {(docs.length > 0 || fotos.length > 0) && (
        <div className="panel p-5">
          <h3 className="mb-2 font-semibold">Archivos cargados</h3>
          <ul className="divide-y divide-[var(--borde)] text-sm">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">{d.nombre}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="insignia">{ETIQUETA_TIPO[d.tipo as keyof typeof ETIQUETA_TIPO] ?? d.tipo}</span>
                  <button className="texto-suave underline" onClick={() => quitar(d.id)} aria-label={`Quitar ${d.nombre}`}>quitar</button>
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
        <h3 className="font-semibold">Leer los documentos</h3>
        <p className="texto-suave text-sm">Extrae acta, provisión y presupuesto, calcula la UF de la fecha del siniestro y deja el caso listo para ajustar. Es seguro repetirlo.</p>
        <button className="btn" onClick={() => proc.ejecutar()} disabled={proc.cargando || docs.length === 0}>
          {proc.cargando ? "Leyendo…" : "Leer documentos"}
        </button>
        {proc.error && <p role="alert" className="aviso aviso-error">{proc.error}</p>}
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
