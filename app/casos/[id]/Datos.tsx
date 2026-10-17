"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Caso } from "@/lib/caso/repositorio";
import { useAccionesMenu } from "@/components/Shell";
import TituloAyuda from "@/components/Ayuda";
import { generoPorNombre, numeroFlexible, tratamiento } from "@/lib/domain/genero";

const FECHA = /^\d{2}\/\d{2}\/\d{4}$/;

const Campo = ({ n, t, v, ayuda, area }: { n: string; t: string; v?: string | number | null; ayuda?: string; area?: boolean }) => (
  <div>
    <label className="etiqueta" htmlFor={n}>{t}</label>
    {area ? <textarea id={n} name={n} defaultValue={v ?? ""} rows={4} className="campo" /> : <input id={n} name={n} defaultValue={v ?? ""} className="campo" />}
    {ayuda && <p className="texto-suave mt-1 text-xs">{ayuda}</p>}
  </div>
);

/** Los dos textos del informe que salen de la inspección: el usuario los corrige y «Guardar e insertar» los deja en el informe. */
function TextosInforme({ caso, propuesta, hayInforme }: { caso: Caso; propuesta: { caracteristicas: string; evidencia: string }; hayInforme: boolean }) {
  const router = useRouter();
  const [car, setCar] = useState(propuesta.caracteristicas);
  const [evi, setEvi] = useState(propuesta.evidencia);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const cambiado = car !== propuesta.caracteristicas || evi !== propuesta.evidencia;

  async function guardar() {
    setGuardando(true);
    setMsg(null);
    const r = await fetch(`/api/casos/${caso.id}/textos-informe`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caracteristicas: car, evidencia: evi }) });
    setGuardando(false);
    const j = (await r.json().catch(() => ({}))) as { error?: string; insertado?: boolean; avisos?: string[] };
    if (!r.ok) return setMsg({ tipo: "error", texto: j.error ?? "No se pudo guardar" });
    setMsg({ tipo: "ok", texto: j.insertado ? "Guardado e insertado en el informe (el PDF y el ZIP se rehicieron)." : `Guardado: se usará al generar el informe.${j.avisos?.length ? " " + j.avisos.join(" ") : ""}` });
    router.refresh();
  }

  return (
    <div className="panel space-y-3 p-5">
      <TituloAyuda titulo="Textos del informe" nivel={2}>
        <p>Salen de la inspección (descripción del inmueble y tabla de daños). Corrígelos si hace falta y usa «Guardar e insertar»: se guardan y, si el informe ya está generado, se insertan en él sin tocar el resto del documento. En la evidencia, cada línea es una viñeta con «Recinto: texto».</p>
      </TituloAyuda>
      <div>
        <label className="etiqueta" htmlFor="texto-caracteristicas">Características del bien en riesgo</label>
        <textarea id="texto-caracteristicas" rows={4} className="campo" value={car} onChange={(e) => setCar(e.target.value)} />
      </div>
      <div>
        <label className="etiqueta" htmlFor="texto-evidencia">Evidencia observada (una viñeta por línea)</label>
        <textarea id="texto-evidencia" rows={8} className="campo" value={evi} onChange={(e) => setEvi(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" disabled={guardando || (!cambiado && !hayInforme)} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar e insertar en el informe"}
        </button>
        <button type="button" className="btn btn-sec" disabled={guardando || !cambiado} onClick={() => { setCar(propuesta.caracteristicas); setEvi(propuesta.evidencia); }}>Deshacer cambios</button>
      </div>
      {msg && <p role={msg.tipo === "error" ? "alert" : "status"} className={`aviso ${msg.tipo === "ok" ? "aviso-ok" : "aviso-error"}`}>{msg.texto}</p>}
    </div>
  );
}

export default function Datos({ caso, propuesta, hayInforme }: { caso: Caso; propuesta: { caracteristicas: string; evidencia: string } | null; hayInforme: boolean }) {
  const router = useRouter();
  const d = caso.datos;
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const t = (k: string) => String(f.get(k) ?? "").trim();
    const fecha = (k: string) => (t(k) === "" ? null : t(k));
    for (const k of ["emision", "informadoPartes"]) if (fecha(k) && !FECHA.test(fecha(k)!)) return setMsg({ tipo: "error", texto: "Las fechas van como dd/mm/aaaa" });
    const uf = numeroFlexible(t("valor_uf"));
    setGuardando(true);
    const r = await fetch(`/api/casos/${caso.id}/datos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siniestro: t("siniestro"),
        liquidacion: t("liquidacion"),
        asegurado: { nombre: t("nombre"), rut: t("rut"), genero: t("genero") === "" ? null : (t("genero") as "m" | "f") },
        ubicacion: t("ubicacion"),
        denunciaTexto: t("denuncia") || null,
        fechas: { emision: fecha("emision"), informadoPartes: fecha("informadoPartes") },
        poliza: { sumaAseguradaUF: numeroFlexible(t("suma")) || 0 },
        ...(uf > 0 ? { valor_uf: uf } : {}),
      }),
    });
    setGuardando(false);
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) return setMsg({ tipo: "error", texto: j.error ?? "No se pudo guardar" });
    setMsg({ tipo: "ok", texto: "Datos guardados" });
    router.refresh();
  }

  useAccionesMenu([
    { id: "guardar-datos", etiqueta: guardando ? "Guardando…" : "Guardar datos", icono: "guardar", primaria: true, deshabilitado: guardando || !d.asegurado, onClick: () => (document.getElementById("form-datos") as HTMLFormElement | null)?.requestSubmit() },
  ]);

  if (!d.asegurado) return <p className="panel texto-suave p-5">Primero lee los documentos en el paso 1.</p>;

  return (
    <div className="space-y-4">
    <form id="form-datos" onSubmit={guardar} className="panel space-y-4 p-5">
      <TituloAyuda titulo="Datos del siniestro" nivel={2}>
        <p>Lo que sale de los PDF viene prellenado. Corrige tildes y completa (luego usa «Guardar datos» en el menú lateral) lo que sólo tú sabes: el texto de la denuncia y las fechas de emisión e información a las partes.</p>
      </TituloAyuda>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo n="siniestro" t="N.º de siniestro" v={d.siniestro} />
        <Campo n="liquidacion" t="N.º de liquidación" v={d.liquidacion} />
        <Campo n="nombre" t="Asegurado" v={d.asegurado.nombre} ayuda="Con tildes y ñ: los PDF fuente no las traen." />
        <Campo n="rut" t="RUT del asegurado" v={d.asegurado.rut} />
        <div>
          <label className="etiqueta" htmlFor="genero">Tratamiento del asegurado en el informe</label>
          <select id="genero" name="genero" className="campo" defaultValue={d.asegurado.genero ?? ""}>
            <option value="">Automático según el nombre ({tratamiento(generoPorNombre(d.asegurado.nombre) ?? "m")})</option>
            <option value="m">el Sr. (hombre)</option>
            <option value="f">la Sra. (mujer)</option>
          </select>
          <p className="texto-suave mt-1 text-xs">Sale en frases como «{tratamiento(d.asegurado.genero ?? generoPorNombre(d.asegurado.nombre) ?? "m")} {d.asegurado.nombre}».</p>
        </div>
        <Campo n="ubicacion" t="Ubicación del riesgo" v={d.ubicacion} />
        <Campo n="suma" t="Suma asegurada (UF)" v={d.poliza?.sumaAseguradaUF != null ? String(d.poliza.sumaAseguradaUF).replace(".", ",") : ""} ayuda="Sale del borrador del informe; con coma decimal (1294,50)." />
        <Campo n="valor_uf" t="UF a la fecha del siniestro ($)" v={caso.valor_uf != null ? String(caso.valor_uf).replace(".", ",") : ""} ayuda="Se obtiene sola desde mindicador.cl; edítala solo si no se pudo. Con coma decimal (40844,79)." />
        <Campo n="emision" t="Fecha de emisión del informe" v={d.fechas?.emision} ayuda="dd/mm/aaaa" />
        <Campo n="informadoPartes" t="Fecha en que se informó a las partes" v={d.fechas?.informadoPartes} ayuda="dd/mm/aaaa" />
      </div>
      <Campo n="denuncia" t="Texto de la denuncia (tal como la entregó el asegurador)" v={d.denunciaTexto} area ayuda="Si lo dejas vacío, el informe lleva la alerta [FALTA DATO] en negrita." />
      <div className="texto-suave grid gap-1 text-sm sm:grid-cols-2">
        <span>Póliza: {d.poliza?.numero} · ítem {d.poliza?.item}</span>
        <span>Vigencia: {d.poliza?.vigenciaDesde} a {d.poliza?.vigenciaHasta}</span>
        <span>Ocurrencia: {d.fechas?.ocurrencia}</span>
        <span>Inspección: {d.fechas?.inspeccion}</span>
      </div>
      {msg && <p role={msg.tipo === "error" ? "alert" : "status"} className={`aviso ${msg.tipo === "ok" ? "aviso-ok" : "aviso-error"}`}>{msg.texto}</p>}
    </form>
    {propuesta && <TextosInforme key={propuesta.caracteristicas + propuesta.evidencia} caso={caso} propuesta={propuesta} hayInforme={hayInforme} />}
    </div>
  );
}
