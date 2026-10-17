import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { leerExtraccion, listarArchivos, leerReclamacion, obtenerCaso, ultimoAjuste } from "@/lib/caso/repositorio";
import Shell from "@/components/Shell";
import { hayProveedorActivo } from "@/lib/ia/repo-proveedores";
import { informeAlDia, leerLeyendasGrupos } from "@/lib/caso/generacion";
import { seleccionarFotosInforme } from "@/lib/docs/fotos-seleccion";
import { salidaBase } from "@/lib/caso/ajuste-base";
import type { ActaInspeccion } from "@/lib/extraccion/acta";
import PanelCaso from "./PanelCaso";
import { ordenarGruposPorPresupuesto } from "@/lib/fotos/orden";

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
  const seccionesPresupuesto = (recl?.datos.secciones ?? []).map((s) => s.titulo);
  const fotos = ordenarGruposPorPresupuesto(archivos.filter((a) => a.tipo === "foto").map((a) => ({ ...a, recinto: a.recinto ?? "General" })), seccionesPresupuesto);
  // Las fotos se muestran (y se entregan) por estancia, en el mismo orden que el presupuesto.
  const archivosEnOrden = [...archivos.filter((a) => a.tipo !== "foto"), ...fotos.map((f) => archivos.find((a) => a.id === f.id)!)];
  const enInforme = acta ? seleccionarFotosInforme(fotos, acta).fotos.map((f) => f.id) : [];
  const [leyendasGrupos, alDia] = await Promise.all([leerLeyendasGrupos(id), informeAlDia(id)]);
  // Con presupuesto pero sin ajuste guardado, el paso Ajuste parte de «sin ajustar»: todas las partidas tal como se reclamaron, editables a mano.
  const ajusteBase = recl && !ajuste && caso.modo === "reclamacion" ? salidaBase(acta) : null;
  return (
    <Shell nombre={u.nombre}>
        <PanelCaso
          caso={JSON.parse(JSON.stringify(caso))}
          archivos={JSON.parse(JSON.stringify(archivosEnOrden))}
          reclamacion={recl ? JSON.parse(JSON.stringify(recl.datos)) : null}
          ajuste={ajuste ? JSON.parse(JSON.stringify(ajuste)) : null}
          ajusteBase={ajusteBase}
          iaConfigurada={ia}
          enInforme={enInforme}
          leyendasGrupos={leyendasGrupos}
          informeAlDia={alDia}
        />
    </Shell>
  );
}
