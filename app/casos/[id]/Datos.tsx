"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Caso } from "@/lib/caso/repositorio";
import { useAccionesMenu } from "@/components/Shell";

const FECHA = /^\d{2}\/\d{2}\/\d{4}$/;

const Campo = ({ n, t, v, ayuda, area }: { n: string; t: string; v?: string | number | null; ayuda?: string; area?: boolean }) => (
  <div>
    <label className="etiqueta" htmlFor={n}>{t}</label>
    {area ? <textarea id={n} name={n} defaultValue={v ?? ""} rows={4} className="campo" /> : <input id={n} name={n} defaultValue={v ?? ""} className="campo" />}
    {ayuda && <p className="texto-suave mt-1 text-xs">{ayuda}</p>}
  </div>
);

export default function Datos({ caso }: { caso: Caso }) {
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
    const uf = Number(t("valor_uf").replace(/\./g, "").replace(",", "."));
    setGuardando(true);
    const r = await fetch(`/api/casos/${caso.id}/datos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siniestro: t("siniestro"),
        liquidacion: t("liquidacion"),
        asegurado: { nombre: t("nombre"), rut: t("rut") },
        ubicacion: t("ubicacion"),
        denunciaTexto: t("denuncia") || null,
        fechas: { emision: fecha("emision"), informadoPartes: fecha("informadoPartes") },
        poliza: { sumaAseguradaUF: Number(t("suma").replace(/\./g, "").replace(",", ".")) || 0 },
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
    <form id="form-datos" onSubmit={guardar} className="panel space-y-4 p-5">
      <p className="texto-suave text-sm">
        Lo que sale de los PDF viene prellenado. Corrige tildes y completa (luego usa «Guardar datos» en el menú lateral) lo que sólo tú sabes: el texto de la denuncia y las fechas de emisión e información a las partes.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo n="siniestro" t="N.º de siniestro" v={d.siniestro} />
        <Campo n="liquidacion" t="N.º de liquidación" v={d.liquidacion} />
        <Campo n="nombre" t="Asegurado" v={d.asegurado.nombre} ayuda="Con tildes y ñ: los PDF fuente no las traen." />
        <Campo n="rut" t="RUT del asegurado" v={d.asegurado.rut} />
        <Campo n="ubicacion" t="Ubicación del riesgo" v={d.ubicacion} />
        <Campo n="suma" t="Suma asegurada (UF)" v={d.poliza?.sumaAseguradaUF} />
        <Campo n="valor_uf" t="UF a la fecha del siniestro ($)" v={caso.valor_uf ?? ""} ayuda="Se obtiene sola desde mindicador.cl; edítala solo si no se pudo." />
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
  );
}
