import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { listarArchivos, leerReclamacion, obtenerCaso, ultimoAjuste } from "@/lib/caso/repositorio";
import Cabecera from "@/components/Cabecera";
import PanelCaso from "./PanelCaso";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PaginaCaso({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario();
  const { id } = await params;
  const caso = await obtenerCaso(id, u.id);
  if (!caso) notFound();
  const [archivos, recl, ajuste] = await Promise.all([listarArchivos(id), leerReclamacion(id), ultimoAjuste(id)]);
  return (
    <>
      <Cabecera nombre={u.nombre} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <PanelCaso
          caso={JSON.parse(JSON.stringify(caso))}
          archivos={JSON.parse(JSON.stringify(archivos))}
          reclamacion={recl ? JSON.parse(JSON.stringify(recl.datos)) : null}
          ajuste={ajuste ? JSON.parse(JSON.stringify(ajuste)) : null}
        />
      </main>
    </>
  );
}
