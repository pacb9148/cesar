import { FOTOS_MAX_POR_RECINTO_INFORME } from "../domain/constantes";
import type { ActaInspeccion, DanoActa } from "../extraccion/acta";
import { ordenarPorGrupo } from "../fotos/orden";
import { leyendaCorta } from "./fotos-xml";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const coincide = (a: string, b: string) => a !== "" && b !== "" && (a.includes(b) || b.includes(a));
const titulo = (s: string) => {
  const t = s.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const danoDe = (recinto: string, acta: ActaInspeccion): DanoActa | undefined => acta.danos.find((d) => coincide(norm(recinto), norm(d.recinto)));

/** Leyenda de una línea: «Recinto: daño según el acta»; sin daño registrado, solo el recinto. */
export function leyendaDeFoto(recinto: string, acta: ActaInspeccion): string {
  const d = danoDe(recinto, acta);
  const detalle = (d?.descripcion || d?.tipoDano || "").replace(/\s+/g, " ").trim().toLowerCase();
  return leyendaCorta(detalle ? `${titulo(recinto)}: ${detalle}` : titulo(recinto));
}

/**
 * Fotos del informe: solo de los recintos con daño en el acta (el área afectada) y un máximo por recinto; si ninguna foto
 * corresponde a un recinto dañado se usan todas, para no dejar el informe sin imágenes. El anexo lleva el resto.
 */
export function fotosDelAreaAfectada<T extends { recinto: string }>(fotos: T[], acta: ActaInspeccion, max = FOTOS_MAX_POR_RECINTO_INFORME): T[] {
  const afectadas = fotos.filter((f) => danoDe(f.recinto, acta));
  const base = afectadas.length > 0 ? afectadas : fotos;
  const cuenta = new Map<string, number>();
  return base.filter((f) => {
    const n = cuenta.get(f.recinto) ?? 0;
    cuenta.set(f.recinto, n + 1);
    return n < max;
  });
}

/**
 * Fotos del informe: las del área afectada que elige el sistema, más las que el usuario añadió (✓), menos las que quitó. Así todo parte
 * marcado por defecto y cualquier cambio del usuario vuelve a componer el informe con la nueva disposición. Conserva el orden de las fotos.
 */
export function seleccionarFotosInforme<T extends { recinto: string; edicion?: { incluir?: boolean; excluir?: boolean; orden?: number } | null }>(todas: T[], acta: ActaInspeccion): { fotos: T[]; elegidas: boolean } {
  const auto = new Set<T>(fotosDelAreaAfectada(todas, acta));
  const fotos = ordenarPorGrupo(todas.filter((f) => f.edicion?.excluir !== true && (auto.has(f) || f.edicion?.incluir === true)));
  return { fotos, elegidas: todas.some((f) => f.edicion?.incluir === true || f.edicion?.excluir === true) };
}
