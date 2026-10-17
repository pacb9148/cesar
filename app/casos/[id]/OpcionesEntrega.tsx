"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DatosCaso } from "@/lib/domain/tipos";
import { CALIDAD_POR_DEFECTO, type Calidad } from "@/lib/fotos/calidad";
import TituloAyuda from "@/components/Ayuda";

type Entrega = NonNullable<DatosCaso["entrega"]>;

/** Cómo se entregan los documentos: resolución de las fotos y maquetación del anexo. Se guarda en los datos del caso y se aplica al volver a generar. */
export default function OpcionesEntrega({ casoId, entrega }: { casoId: string; entrega?: Entrega }) {
  const router = useRouter();
  const [actual, setActual] = useState<Entrega>(entrega ?? { calidad: CALIDAD_POR_DEFECTO, anexoCompacto: false });
  const [error, setError] = useState<string | null>(null);

  async function guardar(nuevo: Entrega) {
    const previo = actual;
    setActual(nuevo);
    setError(null);
    const r = await fetch(`/api/casos/${casoId}/datos`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entrega: nuevo }) });
    if (!r.ok) {
      setActual(previo);
      setError((await r.json().catch(() => null))?.error ?? "No se pudo guardar la opción");
      return;
    }
    router.refresh();
  }

  const calidades: { valor: Calidad; titulo: string; detalle: string }[] = [
    { valor: "150", titulo: "150 ppp (recomendado)", detalle: "Archivos mucho más livianos; nítido en pantalla y en impresión normal." },
    { valor: "300", titulo: "300 ppp", detalle: "Máxima resolución; el informe pesa bastante más." },
  ];

  return (
    <div className="panel space-y-3 p-5">
      <TituloAyuda titulo="Opciones de entrega" nivel={3}>
        <p>La calidad define la resolución de las fotos que se incrustan en el informe y en el anexo. El anexo compacto quita la portada y los saltos de página entre estancias, y usa márgenes de 1,5 cm arriba y abajo y 1,84 cm a los lados. Los cambios se aplican al volver a generar el informe.</p>
      </TituloAyuda>
      <fieldset className="space-y-2">
        <legend className="sr-only">Calidad de las fotos</legend>
        {calidades.map((c) => (
          <label key={c.valor} className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="calidad" className="mt-1" checked={actual.calidad === c.valor} onChange={() => void guardar({ ...actual, calidad: c.valor })} />
            <span>
              <span className="font-medium">{c.titulo}</span>
              <span className="texto-suave block text-sm">{c.detalle}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" className="mt-1" checked={actual.anexoCompacto} onChange={(e) => void guardar({ ...actual, anexoCompacto: e.target.checked })} />
        <span>
          <span className="font-medium">Anexo compacto</span>
          <span className="texto-suave block text-sm">Sin portada, flujo continuo y márgenes reducidos.</span>
        </span>
      </label>
      {error && <p role="alert" className="aviso aviso-error">{error}</p>}
    </div>
  );
}
