"use client";

import { useState } from "react";
import VentanaModal from "@/components/VentanaModal";
import { numeroChileno, UF_MAX, UF_MIN } from "@/lib/domain/numero";

const formato = (n: number) => n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaLegible = (iso: string) => iso.split("-").reverse().join("-");

/**
 * Ventana para agregar o modificar la UF del día del siniestro: se escribe a mano (acepta «40.844,79») o se busca en mindicador.cl, y se guarda en el caso.
 * El servicio es lento y a veces no responde: si falla, el usuario la ingresa a mano.
 */
export default function ValorUF({ casoId, valor, fecha, motivo, onGuardada, onCerrar }: { casoId: string; valor: number; fecha: string; motivo?: string; onGuardada: (valor: number) => void; onCerrar: () => void }) {
  const [texto, setTexto] = useState(valor > 0 ? formato(valor) : "");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function buscar() {
    setBuscando(true);
    setError(null);
    setAviso("Consultando mindicador.cl… puede tardar unos segundos.");
    try {
      const r = await fetch(`/api/casos/${casoId}/uf`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { valor?: number | null; error?: string };
      if (!r.ok) setError(j.error ?? "No se pudo consultar la UF");
      else if (typeof j.valor === "number") {
        setTexto(formato(j.valor));
        setAviso(`UF del ${fechaLegible(fecha)} según mindicador.cl. Revísala y guarda.`);
        return;
      } else setError("mindicador.cl no respondió. Ingresa la UF a mano.");
      setAviso(null);
    } catch {
      setAviso(null);
      setError("No se pudo consultar la UF. Ingrésala a mano.");
    } finally {
      setBuscando(false);
    }
  }

  async function guardar() {
    const n = numeroChileno(texto);
    if (n === null) return setError("Escribe un número, por ejemplo 40.844,79.");
    if (n < UF_MIN || n > UF_MAX) return setError(`La UF debe estar entre ${UF_MIN.toLocaleString("es-CL")} y ${UF_MAX.toLocaleString("es-CL")}: revisa el punto y la coma decimal.`);
    setGuardando(true);
    setError(null);
    const r = await fetch(`/api/casos/${casoId}/datos`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valor_uf: n }) });
    setGuardando(false);
    if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar la UF");
    onGuardada(n);
  }

  return (
    <VentanaModal etiqueta="Valor de la UF" titulo="Agregar/Modificar UF" subtitulo={`UF del día del siniestro (${fechaLegible(fecha)}).`} onCerrar={onCerrar} ancho="max-w-lg" nivel={60}
      acciones={
        <button type="button" className="btn !px-3 !py-1.5 text-sm" onClick={() => void guardar()} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar UF"}
        </button>
      }
    >
      {() => (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-sm text-[color:var(--texto)]">
          {motivo && <p className="aviso aviso-alerta">{motivo}</p>}
          {error && <p role="alert" className="aviso aviso-error">{error}</p>}
          {aviso && <p role="status" className="aviso aviso-ok">{aviso}</p>}
          <label className="block space-y-1">
            <span className="font-medium">Valor de la UF ($)</span>
            <input className="campo w-full text-right" inputMode="decimal" value={texto} placeholder="40.844,79" onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void guardar()} />
            <span className="texto-suave text-xs">Con coma decimal (40.844,79) o punto (40844.79). La UF convierte los pesos del ajuste y se usa en el Excel y en el informe.</span>
          </label>
          <button type="button" className="btn btn-sec" onClick={() => void buscar()} disabled={buscando}>
            {buscando ? "Buscando…" : "Buscar en mindicador.cl"}
          </button>
        </div>
      )}
    </VentanaModal>
  );
}
