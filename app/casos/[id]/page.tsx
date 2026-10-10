import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { leerExtraccion, listarArchivos, leerReclamacion, obtenerCaso, ultimoAjuste } from "@/lib/caso/repositorio";
import Shell from "@/components/Shell";
import { hayProveedorActivo } from "@/lib/ia/repo-proveedores";
import { informeAlDia, leerLeyendasGrupos } from "@/lib/caso/generacion";
import { seleccionarFotosInforme } from "@/lib/docs/fotos-seleccion";
import type { ActaInspeccion } from "@/lib/extraccion/acta";
import PanelCaso from "./PanelCaso";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PaginaCaso({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario();
  const { id } = await params;
  const caso = await obtenerCaso(id, u.id);
  if (!caso) notFound();
  const [archivos, recl, ajuste, ia] = await Promise.all([listarArchivos(id), leerReclamacion(id), ultimoAjuste(id), hayProveedorActivo(u.id)]);
  // Fotos que van al informe: las que elige el sistema (recintos con daño) más las que añadió el usuario, menos las que quitó.
  const acta = await leerExtraccion<ActaInspeccion>(id, "acta");
  const fotos = archivos.filter((a) => a.tipo === "foto").map((a) => ({ ...a, recinto: a.recinto ?? "General" }));
  const enInforme = acta ? seleccionarFotosInforme(fotos, acta).fotos.map((f) => f.id) : [];
  const [leyendasGrupos, alDia] = await Promise.all([leerLeyendasGrupos(id), informeAlDia(id)]);
  return (
    <Shell nombre={u.nombre}>
        <PanelCaso
          caso={JSON.parse(JSON.stringify(caso))}
          archivos={JSON.parse(JSON.stringify(archivos))}
          reclamacion={recl ? JSON.parse(JSON.stringify(recl.datos)) : null}
          ajuste={ajuste ? JSON.parse(JSON.stringify(ajuste)) : null}
          iaConfigurada={ia}
          enInforme={enInforme}
          leyendasGrupos={leyendasGrupos}
          informeAlDia={alDia}
        />
    </Shell>
  );
}
