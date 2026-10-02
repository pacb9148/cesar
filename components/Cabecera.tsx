import Link from "next/link";
import BotonSalir from "./BotonSalir";

export default function Cabecera({ nombre }: { nombre: string }) {
  return (
    <header className="border-b border-[var(--borde)] bg-[var(--panel)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/casos" className="font-bold">Ajustador de Siniestros</Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="texto-suave">{nombre}</span>
          <BotonSalir />
        </div>
      </div>
    </header>
  );
}
