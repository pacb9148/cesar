const STOP = new Set(["de", "del", "la", "el", "en", "y", "e", "con", "para", "por", "al", "los", "las", "a", "provi", "provision"]);

/** Clave estable de un texto: sin tildes, mayúsculas ni signos, con las palabras vacías fuera. «Provi. y colocacion» y «Provisión y colocación» dan la misma. */
export function normClave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t))
    .join(" ");
}

export type Elemento = "cielo" | "muro" | "piso" | "cubierta" | "guardapolvo" | "cornisa" | "otros";

/** Elemento constructivo al que se refiere un texto (título de sección o descripción de partida). */
export function elementoDe(texto: string): Elemento {
  const t = texto.toLowerCase();
  if (/guardapolvo/.test(t)) return "guardapolvo";
  if (/cornisa/.test(t)) return "cornisa";
  if (/cielo/.test(t)) return "cielo";
  if (/muro|tabique|pared|celos[ií]a|ceramica|cerámica/.test(t)) return "muro";
  if (/piso|alfombra|flotante|pavimento|radier/.test(t)) return "piso";
  if (/cubierta|zinc|teja|policarbonato|hojalater|caballete|osb|fieltro/.test(t)) return "cubierta";
  return "otros";
}
