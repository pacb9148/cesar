"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function FormLogin({ primerUso }: { primerUso: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const clave = String(f.get("clave"));
    const r = await fetch(primerUso ? "/api/auth/registro" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(primerUso ? { email, clave, nombre: String(f.get("nombre")) } : { email, clave }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setCargando(false);
    if (!r.ok) return setError(j.error ?? "No se pudo ingresar");
    router.push("/casos");
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="panel space-y-4 p-5">
      {primerUso && (
        <div>
          <label className="etiqueta" htmlFor="nombre">Nombre</label>
          <input id="nombre" name="nombre" required minLength={2} className="campo" autoComplete="name" />
        </div>
      )}
      <div>
        <label className="etiqueta" htmlFor="email">Correo</label>
        <input id="email" name="email" type="email" required className="campo" autoComplete="username" />
      </div>
      <div>
        <label className="etiqueta" htmlFor="clave">Contraseña{primerUso ? " (mínimo 10 caracteres)" : ""}</label>
        <input id="clave" name="clave" type="password" required minLength={primerUso ? 10 : 1} className="campo" autoComplete={primerUso ? "new-password" : "current-password"} />
      </div>
      {error && <p role="alert" className="aviso aviso-error">{error}</p>}
      <button className="btn w-full" disabled={cargando}>{cargando ? "Ingresando…" : primerUso ? "Crear administrador" : "Ingresar"}</button>
    </form>
  );
}
