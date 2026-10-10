import { FOTOS_MAX_POR_RECINTO_INFORME } from "../domain/constantes";
import type { ActaInspeccion, DanoActa } from "../extraccion/acta";
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

/** Fotos del informe: las que el usuario marcó con ✓ (con su recorte) o, si no marcó ninguna, las del área afectada. */
export function seleccionarFotosInforme<T extends { recinto: string; edicion?: { incluir?: boolean; excluir?: boolean } | null }>(todas: T[], acta: ActaInspeccion): { fotos: T[]; elegidas: boolean } {
  const elegidas = todas.filter((f) => f.edicion?.incluir === true);
  return elegidas.length > 0 ? { fotos: elegidas, elegidas: true } : { fotos: fotosDelAreaAfectada(todas.filter((f) => f.edicion?.excluir !== true), acta), elegidas: false };
}
