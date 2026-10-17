import { emitir } from "../traza";
import type { ClienteLlm } from "../ia/gemini";
import { parsearActa, type ActaInspeccion } from "../extraccion/acta";
import { actaConIa, presupuestoConIa, type ActaConExtras } from "../extraccion/ia-documentos";
import { parsearPresupuestoPdf, parsearPresupuestoXlsx, type ResultadoPresupuesto } from "../extraccion/presupuesto";
import { formatoDe, leerTexto, modernizar, type Fuente } from "../extraccion/universal";

export type ObtenerCliente = () => ClienteLlm;

const actaBuena = (a: ActaInspeccion) => !!a.siniestro && a.danos.length > 0;
const vacio = (r: ResultadoPresupuesto) => r.reclamacion.lineas.length === 0;

/**
 * Lee la inspección en cualquier formato. Primero lo determinista (PDF o texto con el formato de Beckett: exacto y gratis); si el documento
 * es de otro formato, una imagen o un escaneo, se lee con IA. Devuelve null si no se pudo, con el motivo en `alertas`.
 */
export async function leerInspeccion(docs: Fuente[], cliente: ObtenerCliente, alertas: string[]): Promise<ActaConExtras | null> {
  let determinista: ActaConExtras | null = null;
  for (const d of docs) {
    try {
      const l = await leerTexto(d);
      if (!l.legible) continue;
      const a = parsearActa(l.paginas);
      emitir("info", "inspeccion", `«${d.nombre}» (${l.formato}): ${a.danos.length} recinto(s) dañado(s) por lectura directa`);
      if (actaBuena(a)) return a;
      determinista ??= a;
    } catch (e) {
      emitir("error", "inspeccion", `No se pudo leer «${d.nombre}» directamente: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  try {
    emitir("info", "inspeccion", "El formato no es el esperado o es una imagen/escaneo: se lee con IA");
    const a = await actaConIa(cliente(), docs);
    emitir("ok", "inspeccion", `Inspección leída con IA: siniestro ${a.siniestro ?? "?"}, ${a.danos.length} recinto(s) dañado(s)`);
    return a;
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "error";
    if (determinista) {
      alertas.push(`La inspección se leyó solo parcialmente (${motivo}). Revisa los datos.`);
      return determinista;
    }
    alertas.push(`No se pudo leer la inspección: ${motivo}`);
    return null;
  }
}

/**
 * Lee el presupuesto en cualquier formato y lo deja como reclamación (partidas, orden, textos y valores del original). Excel y PDF con texto se
 * leen directamente; imágenes, escaneos y Word se transcriben con IA. Nunca se inventan partidas: si no se puede, queda la alerta.
 */
export async function leerPresupuesto(docs: Fuente[], cliente: ObtenerCliente, alertas: string[]): Promise<ResultadoPresupuesto | null> {
  for (const original of docs) {
    try {
      const d = await modernizar(original);
      const f = formatoDe(d.nombre, d.mime);
      if (f === "xlsx") {
        const r = await parsearPresupuestoXlsx(d.contenido);
        if (!vacio(r)) return r;
      } else if (f === "pdf") {
        const l = await leerTexto(d);
        if (l.legible) {
          const r = parsearPresupuestoPdf(l.paginas);
          if (!vacio(r)) return r;
        }
      }
    } catch (e) {
      emitir("error", "presupuesto", `No se pudo leer «${original.nombre}» directamente: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  try {
    emitir("info", "presupuesto", "El presupuesto no tiene un formato de tabla reconocible o es una imagen/escaneo: se transcribe con IA");
    const r = await presupuestoConIa(cliente(), docs);
    if (vacio(r)) {
      alertas.push("No se encontraron partidas en el presupuesto.");
      return null;
    }
    emitir("ok", "presupuesto", `Presupuesto transcrito con IA: ${r.reclamacion.lineas.length} partidas`);
    return r;
  } catch (e) {
    alertas.push(`No se pudo leer el presupuesto: ${e instanceof Error ? e.message : "error"}`);
    return null;
  }
}
