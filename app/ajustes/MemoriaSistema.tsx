"use client";

import { useEffect, useState } from "react";
import { BAREMO } from "@/lib/engine/baremo";
import TituloAyuda from "@/components/Ayuda";

type Entrada = { tipo: "partida" | "elemento"; clave: string; resumen: string; veces: number; actualizado: string };
type Datos = { resumen: { semilla: { descripciones: number; lineas: number; asociadas: number }; aprendido: { descripciones: number; elementos: number } }; entradas: Entrada[] };

const nombreDe = (id: number) => BAREMO.find((b) => b.id === id)?.descripcion ?? `partida ${id}`;

/** Lo que el sistema ha ido aprendiendo de los ajustes guardados; se puede olvidar lo que esté mal. */
export default function MemoriaSistema() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  useEffect(() => {
    let vivo = true;
    fetch("/api/conocimiento", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Datos | null) => {
        if (!vivo) return;
        if (j) setDatos(j);
        else setError("No se pudo leer la memoria del sistema.");
      })
      .catch(() => vivo && setError("No se pudo leer la memoria del sistema."));
    return () => {
      vivo = false;
    };
  }, [version]);

  async function olvidar(e: Entrada) {
    if (!window.confirm(`¿Olvidar «${e.clave}»?`)) return;
    await fetch("/api/conocimiento", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: e.tipo, clave: e.clave }) });
    setVersion((v) => v + 1);
  }

  const describir = (e: Entrada): string => {
    try {
      const ids = JSON.parse(e.resumen) as Record<string, number | { veces: number }>;
      return Object.entries(ids)
        .map(([id, v]) => `${nombreDe(Number(id))} (${typeof v === "number" ? v : v.veces}×)`)
        .join(" · ");
    } catch {
      return e.resumen;
    }
  };

  return (
    <div className="panel mt-6 space-y-3 p-5">
      <TituloAyuda titulo="Memoria del sistema" nivel={2}>
        <p>
          El sistema aprende de cada ajuste que guardas: qué partida de la hoja Datos corresponde a cada descripción del presupuesto y qué partidas sueles agregar en cada elemento (cielo, muro…).
          Parte de lo aprendido de tus ajustes de referencia. Cuando hay algo parecido en un presupuesto nuevo, lo sugiere o lo usa como partida por defecto. Si algo aprendido está mal, olvídalo aquí.
        </p>
      </TituloAyuda>
      {error && <p role="alert" className="aviso aviso-error">{error}</p>}
      {datos && (
        <>
          <p className="text-sm text-[color:var(--texto)]">
            De tus ajustes de referencia: <strong>{datos.resumen.semilla.descripciones}</strong> descripciones asociadas a la hoja Datos ({datos.resumen.semilla.asociadas} de {datos.resumen.semilla.lineas} partidas). Aprendido de lo que has guardado: <strong>{datos.resumen.aprendido.descripciones}</strong> descripciones y <strong>{datos.resumen.aprendido.elementos}</strong> elementos.
          </p>
          {datos.entradas.length === 0 ? (
            <p className="texto-suave text-sm">Aún no hay nada aprendido de tus ajustes: se irá llenando al guardar ajustes con partidas de la hoja Datos.</p>
          ) : (
            <ul className="divide-y divide-[var(--borde)] text-sm">
              {datos.entradas.map((e) => (
                <li key={`${e.tipo}|${e.clave}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="insignia mr-2">{e.tipo === "partida" ? "Partida" : "Elemento"}</span>
                    <strong>{e.clave}</strong> → {describir(e)} <span className="texto-suave">· visto {e.veces}×</span>
                  </span>
                  <button type="button" className="btn btn-sec !px-2 !py-0.5 text-xs" onClick={() => void olvidar(e)} aria-label={`Olvidar ${e.clave}`}>Olvidar</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
