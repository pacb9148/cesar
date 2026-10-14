"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BotonIcono } from "@/components/Iconos";

/** Cambiar el número de siniestro o eliminar un caso desde la lista; pide confirmación y avisa si el número ya existe. */
export default function AccionesCaso({ id, siniestro }: { id: string; siniestro: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function renombrar() {
    const nuevo = window.prompt("Nuevo número de siniestro", siniestro)?.trim();
    if (!nuevo || nuevo === siniestro) return;
    setOcupado(true);
    setError(null);
    const r = await fetch(`/api/casos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siniestro: nuevo }) });
    setOcupado(false);
    if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo cambiar");
    router.refresh();
  }

  async function eliminar() {
    if (!window.confirm(`¿Eliminar el caso ${siniestro} con todos sus archivos, lecturas, ajustes e informes? No se puede deshacer.`)) return;
    setOcupado(true);
    setError(null);
    const r = await fetch(`/api/casos/${id}`, { method: "DELETE" });
    setOcupado(false);
    if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo eliminar");
    router.refresh();
  }

  return (
    <span className="flex items-center gap-1">
      {error && <span role="alert" className="text-xs text-[color:var(--error)]">{error}</span>}
      <BotonIcono icono="lapiz" etiqueta={`Cambiar el número del caso ${siniestro}`} deshabilitado={ocupado} onClick={() => void renombrar()} />
      <BotonIcono icono="papelera" etiqueta={`Eliminar el caso ${siniestro}`} deshabilitado={ocupado} onClick={() => void eliminar()} />
    </span>
  );
}
