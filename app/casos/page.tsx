import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { listarCasos } from "@/lib/caso/repositorio";
import BotonNuevoCaso from "./BotonNuevoCaso";
import Cabecera from "@/components/Cabecera";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ESTADOS: Record<string, string> = {
  borrador: "Borrador",
  extraido: "Documentos leídos",
  ajustado: "Ajustado",
  revisado: "Revisado",
  emitido: "Emitido",
};

export default async function Casos() {
  const u = await exigirUsuario();
  const casos = await listarCasos(u.id);
  return (
    <>
      <Cabecera nombre={u.nombre} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">Casos</h1>
          <BotonNuevoCaso />
        </div>
        {casos.length === 0 ? (
          <p className="panel texto-suave p-6">Aún no hay casos. Crea uno y sube la carpeta del siniestro (acta, provisión, presupuesto y fotografías).</p>
        ) : (
          <ul className="space-y-2">
            {casos.map((c) => (
              <li key={c.id}>
                <Link href={`/casos/${c.id}`} className="panel flex flex-wrap items-center justify-between gap-2 p-4 hover:border-[var(--acento)]">
                  <span>
                    <span className="font-semibold">Siniestro {c.siniestro}</span>
                    <span className="texto-suave ml-3 text-sm">{c.datos.asegurado?.nombre ?? "sin datos aún"}</span>
                  </span>
                  <span className="flex items-center gap-3 text-sm">
                    <span className="insignia">{c.modo === "reclamacion" ? "Con presupuesto" : "Pérdida determinada"}</span>
                    <span className="insignia">{ESTADOS[c.estado] ?? c.estado}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
