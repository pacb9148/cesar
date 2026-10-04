"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export type EventoVista = { tipo: "info" | "ok" | "error" | "espera"; paso: string; texto: string; detalle?: string; t: number };

/**
 * Como useAccion, pero la operación responde en flujo (una línea JSON por evento): expone cada paso en vivo
 * (`eventos`) además del resultado final. Si el servidor responde con un error normal, se muestra como error.
 */
export function useFlujo<T = Record<string, unknown>>(url: string) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<T | null>(null);
  const [eventos, setEventos] = useState<EventoVista[]>([]);
  const ocupado = useRef(false);

  async function ejecutar(cuerpo?: unknown): Promise<T | null> {
    if (ocupado.current) return null;
    ocupado.current = true;
    setCargando(true);
    setError(null);
    setResultado(null);
    setEventos([]);
    let final: T | null = null;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      if (!r.ok || !r.body) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Error ${r.status}`);
        return null;
      }
      const lector = r.body.getReader();
      const dec = new TextDecoder();
      let resto = "";
      const linea = (l: string) => {
        if (!l.trim()) return;
        try {
          const m = JSON.parse(l) as { traza?: EventoVista; fin?: T; falla?: string };
          if (m.traza) setEventos((e) => [...e.slice(-499), m.traza!]);
          if (m.fin !== undefined) {
            final = m.fin;
            setResultado(m.fin);
          }
          if (m.falla) setError(m.falla);
        } catch {
          /* línea parcial o ajena: se ignora */
        }
      };
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        resto += dec.decode(value, { stream: true });
        const partes = resto.split("\n");
        resto = partes.pop() ?? "";
        partes.forEach(linea);
      }
      linea(resto);
      if (final === null) setError((e) => e ?? "La conexión se cortó antes de terminar. Revisa el registro de actividad para ver hasta dónde llegó.");
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fallo de red");
    } finally {
      setCargando(false);
      ocupado.current = false;
    }
    return final;
  }
  return { cargando, error, resultado, eventos, ejecutar };
}
