"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Ejecuta un POST largo (procesar, ajustar, generar) con estado de carga y error visibles. */
export function useAccion<T = Record<string, unknown>>(url: string) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<T | null>(null);

  async function ejecutar(cuerpo?: unknown) {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      const j = (await r.json().catch(() => ({}))) as T & { error?: string };
      if (!r.ok) setError(j.error ?? `Error ${r.status}`);
      else {
        setResultado(j);
        router.refresh();
      }
      return r.ok ? j : null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fallo de red");
      return null;
    } finally {
      setCargando(false);
    }
  }
  return { cargando, error, resultado, ejecutar };
}
