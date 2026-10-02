"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function BotonNuevoCaso() {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  async function crear() {
    setCargando(true);
    const r = await fetch("/api/casos", { method: "POST" });
    const j = (await r.json()) as { id?: string };
    if (j.id) router.push(`/casos/${j.id}`);
    else setCargando(false);
  }
  return (
    <button className="btn" onClick={crear} disabled={cargando}>
      {cargando ? "Creando…" : "Nuevo caso"}
    </button>
  );
}
