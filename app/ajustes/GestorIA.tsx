"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProveedorVista } from "@/lib/ia/repo-proveedores";

type Tipo = { id: string; etiqueta: string; ayuda: string; pideUrl: boolean };
type Prueba = { ok: boolean; ms: number; error?: string };
type Modelo = { id: string; nombre: string };
type Mensaje = { tipo: "ok" | "error"; texto: string };

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "");

function situacion(p: ProveedorVista): { texto: string; clase: string } {
  const pausa = p.enPausaHasta && new Date(p.enPausaHasta) > new Date();
  if (p.activo && p.estado === "ok" && !pausa) return { texto: "En servicio", clase: "aviso-ok" };
  if (p.activo && pausa) return { texto: `En pausa hasta ${hora(p.enPausaHasta)} (el sistema usa el siguiente)`, clase: "aviso-alerta" };
  if (p.estado === "error") return { texto: "Fuera de servicio", clase: "aviso-error" };
  if (!p.activo && p.estado === "ok") return { texto: "Desactivado", clase: "aviso-alerta" };
  return { texto: "Sin probar", clase: "aviso-alerta" };
}

async function llamar<T>(url: string, metodo: string, cuerpo?: unknown): Promise<{ ok: boolean; datos: T & { error?: string } }> {
  const r = await fetch(url, { method: metodo, headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { ok: r.ok, datos: (await r.json().catch(() => ({}))) as T & { error?: string } };
}

export default function GestorIA({ inicial, tipos, max }: { inicial: ProveedorVista[]; tipos: Tipo[]; max: number }) {
  const router = useRouter();
  const [lista, setLista] = useState(inicial);
  const [msg, setMsg] = useState<Mensaje | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [tipo, setTipo] = useState(tipos[0].id);
  const [baseUrl, setBaseUrl] = useState("");
  const [clave, setClave] = useState("");
  const [modelo, setModelo] = useState("");
  const [nombre, setNombre] = useState("");
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const t = tipos.find((x) => x.id === tipo)!;

  const aplicar = (d: { proveedores?: ProveedorVista[] }) => {
    if (d.proveedores) setLista(d.proveedores);
    router.refresh();
  };
  const resultado = (p: Prueba | null | undefined, ok: string) =>
    p ? setMsg(p.ok ? { tipo: "ok", texto: `${ok} (respondió en ${(p.ms / 1000).toFixed(1)} s)` } : { tipo: "error", texto: `La prueba falló: ${p.error}` }) : setMsg({ tipo: "ok", texto: ok });

  async function cargarModelos() {
    setOcupado("modelos");
    setMsg(null);
    const r = await llamar<{ modelos?: Modelo[] }>("/api/ajustes/ia/modelos", "POST", { tipo, baseUrl: baseUrl || undefined, clave });
    setOcupado(null);
    if (!r.ok || !r.datos.modelos) return setMsg({ tipo: "error", texto: r.datos.error ?? "No se pudieron listar los modelos" });
    setModelos(r.datos.modelos);
    setMsg({ tipo: "ok", texto: `Clave aceptada: el proveedor ofrece ${r.datos.modelos.length} modelos. Elige uno o escribe su nombre.` });
  }

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado("agregar");
    setMsg(null);
    const r = await llamar<{ prueba?: Prueba; proveedores?: ProveedorVista[] }>("/api/ajustes/ia", "POST", { tipo, baseUrl: baseUrl || undefined, modelo, clave, nombre: nombre || undefined });
    setOcupado(null);
    if (!r.ok) return setMsg({ tipo: "error", texto: r.datos.error ?? "No se pudo agregar" });
    aplicar(r.datos);
    setClave("");
    resultado(r.datos.prueba, "Proveedor agregado y en servicio");
    if (r.datos.prueba?.ok) {
      setModelo("");
      setModelos([]);
      setNombre("");
    }
  }

  async function accion(id: string, etiqueta: string, fn: () => Promise<{ ok: boolean; datos: { prueba?: Prueba | null; proveedores?: ProveedorVista[]; error?: string } }>, exito: string) {
    setOcupado(`${etiqueta}${id}`);
    setMsg(null);
    const r = await fn();
    setOcupado(null);
    if (!r.ok) return setMsg({ tipo: "error", texto: r.datos.error ?? "No se pudo completar" });
    aplicar(r.datos);
    resultado(r.datos.prueba, exito);
  }

  return (
    <div className="space-y-5">
      {msg && <p role={msg.tipo === "error" ? "alert" : "status"} className={`aviso ${msg.tipo === "ok" ? "aviso-ok" : "aviso-error"}`}>{msg.texto}</p>}

      <section aria-label="Proveedores configurados" className="space-y-3">
        <h2 className="font-semibold">Proveedores (por orden de prioridad)</h2>
        {lista.length === 0 && <p className="panel texto-suave p-4 text-sm">Aún no hay ninguno. Agrega el primero abajo.</p>}
        {lista.map((p, i) => {
          const s = situacion(p);
          const dis = !!ocupado;
          return (
            <article key={p.id} className="panel space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{i + 1}. {p.nombre} <span className="texto-suave font-normal">· {p.modelo}</span></div>
                  <div className="texto-suave text-xs">{tipos.find((x) => x.id === p.tipo)?.etiqueta} · clave …{p.ultimos4}{p.baseUrl ? ` · ${p.baseUrl}` : ""}</div>
                </div>
                <span className={`aviso ${s.clase} py-1 text-xs font-semibold`}>{s.texto}</span>
              </div>
              {p.ultimoError && p.estado === "error" && <p className="aviso aviso-error text-xs">{p.ultimoError}</p>}
              {p.ultimoExito && <p className="texto-suave text-xs">Última respuesta correcta: {hora(p.ultimoExito)}</p>}
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-sec" disabled={dis} onClick={() => accion(p.id, "probar", () => llamar(`/api/ajustes/ia/${p.id}/probar`, "POST"), "Prueba correcta: el proveedor está en servicio")}>
                  {ocupado === `probar${p.id}` ? "Probando…" : "Probar"}
                </button>
                {p.activo ? (
                  <button className="btn btn-sec" disabled={dis} onClick={() => accion(p.id, "act", () => llamar(`/api/ajustes/ia/${p.id}`, "PATCH", { activo: false }), "Proveedor desactivado")}>Desactivar</button>
                ) : (
                  <button className="btn btn-sec" disabled={dis} onClick={() => accion(p.id, "act", () => llamar(`/api/ajustes/ia/${p.id}`, "PATCH", { activo: true }), "Proveedor activado tras una prueba correcta")}>Activar (prueba antes)</button>
                )}
                <button className="btn btn-sec" disabled={dis || i === 0} aria-label={`Subir prioridad de ${p.nombre}`} onClick={() => accion(p.id, "sub", () => llamar(`/api/ajustes/ia/${p.id}`, "PATCH", { mover: "subir" }), "Prioridad actualizada")}>↑</button>
                <button className="btn btn-sec" disabled={dis || i === lista.length - 1} aria-label={`Bajar prioridad de ${p.nombre}`} onClick={() => accion(p.id, "baj", () => llamar(`/api/ajustes/ia/${p.id}`, "PATCH", { mover: "bajar" }), "Prioridad actualizada")}>↓</button>
                <button className="btn btn-sec" disabled={dis} onClick={() => { if (confirm(`¿Eliminar «${p.nombre}» y su clave guardada?`)) void accion(p.id, "del", () => llamar(`/api/ajustes/ia/${p.id}`, "DELETE"), "Proveedor eliminado"); }}>Eliminar</button>
              </div>
            </article>
          );
        })}
      </section>

      <form onSubmit={agregar} className="panel space-y-4 p-5" autoComplete="off">
        <h2 className="font-semibold">Agregar proveedor</h2>
        {lista.length >= max ? (
          <p className="aviso aviso-alerta">Llegaste al máximo de {max} proveedores: elimina alguno para agregar otro.</p>
        ) : (
          <>
            <div>
              <label className="etiqueta" htmlFor="tipo">Proveedor</label>
              <select id="tipo" className="campo" value={tipo} onChange={(e) => { setTipo(e.target.value); setModelos([]); }}>
                {tipos.map((x) => (<option key={x.id} value={x.id}>{x.etiqueta}</option>))}
              </select>
              <p className="texto-suave mt-1 text-xs">{t.ayuda}</p>
            </div>
            {t.pideUrl && (
              <div>
                <label className="etiqueta" htmlFor="base">URL base de la API (https, termina en /v1 normalmente)</label>
                <input id="base" className="campo" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.proveedor.com/v1" required spellCheck={false} />
              </div>
            )}
            <div>
              <label className="etiqueta" htmlFor="clave">Clave de API</label>
              <input id="clave" type="password" className="campo" value={clave} onChange={(e) => setClave(e.target.value)} required autoComplete="new-password" spellCheck={false} placeholder="Pega aquí tu clave" />
              <p className="texto-suave mt-1 text-xs">Se guarda cifrada y no vuelve a mostrarse. Nunca la compartas ni la pegues en un chat.</p>
            </div>
            <div>
              <div className="mb-1 flex items-end justify-between gap-2">
                <label className="etiqueta !mb-0" htmlFor="modelo">Modelo</label>
                <button type="button" className="btn btn-sec" onClick={cargarModelos} disabled={!!ocupado || clave.length < 8 || (t.pideUrl && !baseUrl)}>{ocupado === "modelos" ? "Consultando…" : "Cargar modelos disponibles"}</button>
              </div>
              <input id="modelo" className="campo" list="lista-modelos" value={modelo} onChange={(e) => setModelo(e.target.value)} required spellCheck={false} placeholder="Elige de la lista o escribe el identificador exacto" />
              <datalist id="lista-modelos">{modelos.map((m) => (<option key={m.id} value={m.id}>{m.nombre}</option>))}</datalist>
            </div>
            <div>
              <label className="etiqueta" htmlFor="nombre">Nombre para reconocerlo (opcional)</label>
              <input id="nombre" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder="p. ej. Claude principal" />
            </div>
            <button className="btn" disabled={!!ocupado}>{ocupado === "agregar" ? "Probando conexión…" : "Agregar y probar"}</button>
          </>
        )}
      </form>
    </div>
  );
}
