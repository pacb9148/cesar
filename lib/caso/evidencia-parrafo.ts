import type { EvidenciaRecinto } from "../domain/tipos";

const m2 = (n: number) => `${n.toLocaleString("es-CL", { maximumFractionDigits: 2 })} m²`;
const minus = (s: string) => s.trim().replace(/^\p{Lu}/u, (c) => c.toLowerCase());
const lista = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
const AUTOMATICA = /^.+?:\s*[\d.,]+ m² con daño de tipo (.+?) registrado en el acta de inspección\.?$/i;

/**
 * Convierte la evidencia observada (una viñeta por recinto) en un solo párrafo profesional: agrupa los recintos que comparten el tipo de
 * daño, cita sus metros cuadrados, no repite el nombre del recinto ni las frases hechas de cada viñeta y cierra con el total afectado.
 * Es determinista (sin IA): sirve aunque ningún proveedor responda y el usuario puede ajustar el resultado a mano.
 */
export function redactarEvidencia(evidencias: EvidenciaRecinto[]): string {
  const atribuibles = evidencias.filter((e) => e.atribuible);
  const ajenas = evidencias.filter((e) => !e.atribuible);
  const porTipo = new Map<string, string[]>();
  const libres: string[] = [];
  let total = 0;
  for (const e of atribuibles) {
    const sup = e.m2_acta ?? null;
    if (sup != null) total += sup;
    const marca = AUTOMATICA.exec(e.vineta.trim());
    const nombre = e.recinto.trim().toLowerCase();
    if (marca) {
      const tipo = marca[1].trim().toLowerCase();
      porTipo.set(tipo, [...(porTipo.get(tipo) ?? []), sup != null ? `${nombre} (${m2(sup)})` : nombre]);
    } else {
      // Texto libre (p. ej. redactado por la IA): se conserva sin el prefijo «Recinto:» ni el «N m² según acta» final.
      let texto = e.vineta.trim();
      const prefijo = `${e.recinto}:`;
      if (texto.toLowerCase().startsWith(prefijo.toLowerCase())) texto = texto.slice(prefijo.length);
      texto = texto.replace(/\s*[\d.,]+ m² según acta\.?$/i, "").replace(/\.+$/, "").trim();
      if (texto) libres.push(`en ${nombre}${sup != null ? ` (${m2(sup)})` : ""} se observó ${minus(texto)}`);
    }
  }
  const frases: string[] = [];
  const grupos = [...porTipo.entries()].map(([tipo, recintos]) => (/^(no clasificado|sin clasificar|)$/.test(tipo) ? `daños sin clasificar en ${lista(recintos)}` : `daños de tipo ${tipo} en ${lista(recintos)}`));
  if (grupos.length) frases.push(`Durante la visita de inspección se constataron ${grupos.join(", así como ")}.`);
  if (libres.length) frases.push(`${grupos.length ? "Además, " : "Durante la visita de inspección, "}${lista(libres)}.`.replace(/^(Además, |Durante la visita de inspección, )(\w)/, (_m, a: string, b: string) => `${a}${b}`));
  if (atribuibles.length > 1 && total > 0) frases.push(`En total, la superficie afectada registrada en el acta alcanza ${m2(total)}.`);
  if (ajenas.length) frases.push(`No se atribuyen al siniestro los daños observados en ${lista(ajenas.map((e) => minus(e.recinto)))}.`);
  return frases.join(" ");
}
