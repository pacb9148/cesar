"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Estado = { configurada: boolean; modelo: string | null; ultimos4: string | null; actualizado: string | null };
type Modelo = { id: string; nombre: string };

export default function FormIA({ inicial }: { inicial: Estado }) {
  const router = useRouter();
  const [estado, setEstado] = useState(inicial);
  const [clave, setClave] = useState("");
  const [modelo, setModelo] = useState(inicial.modelo ?? "");
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<"probar" | "guardar" | "borrar" | null>(null);

  async function probar() {
    setOcupado("probar");
    setMsg(null);
    const r = await fetch("/api/ajustes/ia/probar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(clave ? { clave } : {}) });
    const j = (await r.json().catch(() => ({}))) as { modelos?: Modelo[]; error?: string };
    setOcupado(null);
    if (!r.ok || !j.modelos) return setMsg({ tipo: "error", texto: j.error ?? "No se pudo probar la clave" });
    setModelos(j.modelos);
    if (!modelo && j.modelos[0]) setModelo(j.modelos.find((m) => /pro/.test(m.id))?.id ?? j.modelos[0].id);
    setMsg({ tipo: "ok", texto: `Clave válida. Google habilita ${j.modelos.length} modelos Gemini para ella; elige uno de la lista.` });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!modelo) return setMsg({ tipo: "error", texto: "Elige o escribe un modelo (usa «Probar clave» para ver los disponibles)." });
    setOcupado("guardar");
    setMsg(null);
    const r = await fetch("/api/ajustes/ia", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelo, ...(clave ? { clave } : {}) }) });
    const j = (await r.json().catch(() => ({}))) as Estado & { error?: string };
    setOcupado(null);
    if (!r.ok) return setMsg({ tipo: "error", texto: j.error ?? "No se pudo guardar" });
    setEstado(j);
    setClave("");
    setMsg({ tipo: "ok", texto: "Guardado." });
    router.refresh();
  }

  async function borrar() {
    if (!confirm("¿Borrar tu clave guardada?")) return;
    setOcupado("borrar");
    const r = await fetch("/api/ajustes/ia", { method: "DELETE" });
    setOcupado(null);
    if (r.ok) {
      setEstado((await r.json()) as Estado);
      setMsg({ tipo: "ok", texto: "Clave borrada." });
      router.refresh();
    }
  }

  return (
    <form onSubmit={guardar} className="panel space-y-4 p-5" autoComplete="off">
      <div aria-live="polite">
        {estado.configurada ? (
          <p className="aviso aviso-ok">
            Clave guardada terminada en <strong>…{estado.ultimos4}</strong> · modelo <strong>{estado.modelo}</strong>
          </p>
        ) : (
          <p className="aviso aviso-alerta">Aún no hay clave guardada.</p>
        )}
      </div>

      <div>
        <label className="etiqueta" htmlFor="clave">Clave de API de Gemini {estado.configurada && "(déjala vacía para conservar la guardada)"}</label>
        <input id="clave" type="password" className="campo" value={clave} onChange={(e) => setClave(e.target.value)} placeholder={estado.configurada ? `••••••••${estado.ultimos4}` : "Pega aquí tu clave"} autoComplete="new-password" spellCheck={false} />
        <p className="texto-suave mt-1 text-xs">
          Se obtiene gratis en Google AI Studio. Nunca la compartas ni la pegues en un chat.
        </p>
      </div>

      <div>
        <label className="etiqueta" htmlFor="modelo">Modelo</label>
        {modelos.length > 0 ? (
          <select id="modelo" className="campo" value={modelo} onChange={(e) => setModelo(e.target.value)}>
            {!modelos.some((m) => m.id === modelo) && modelo && <option value={modelo}>{modelo} (guardado)</option>}
            {modelos.map((m) => (<option key={m.id} value={m.id}>{m.id} — {m.nombre}</option>))}
          </select>
        ) : (
          <input id="modelo" className="campo" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Pulsa «Probar clave» para listar los modelos disponibles" spellCheck={false} />
        )}
      </div>

      {msg && <p role={msg.tipo === "error" ? "alert" : "status"} className={`aviso ${msg.tipo === "ok" ? "aviso-ok" : "aviso-error"}`}>{msg.texto}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sec" onClick={probar} disabled={!!ocupado || (!clave && !estado.configurada)}>{ocupado === "probar" ? "Probando…" : "Probar clave y ver modelos"}</button>
        <button className="btn" disabled={!!ocupado}>{ocupado === "guardar" ? "Guardando…" : "Guardar"}</button>
        {estado.configurada && <button type="button" className="btn btn-sec" onClick={borrar} disabled={!!ocupado}>Borrar clave</button>}
      </div>
    </form>
  );
}
