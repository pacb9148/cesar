/**
 * Número escrito por una persona: acepta coma decimal chilena («40.844,79»), punto decimal («40844.79») y puntos de miles («40.844»).
 * Nunca se quitan los puntos a ciegas: «40844.79» no puede convertirse en 4.084.479. Devuelve null si el texto no es un número reconocible.
 */
export function numeroChileno(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, "");
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d+(,\d+)?$/.test(t)) return Number(t.replace(",", "."));
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

/** La UF ronda los 40.000 pesos: fuera de este rango es un error de tipeo (p. ej. 4.084.479 por quitar el decimal). Mismo rango que valida el servidor. */
export const UF_MIN = 1000;
export const UF_MAX = 200000;
