import baremoJson from "../baremo/baremo.json";

export type ItemBaremo = { id: number; descripcion: string; pu: number };
export const BAREMO: ItemBaremo[] = baremoJson as ItemBaremo[];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const STOP = new Set(["de", "del", "la", "el", "en", "y", "e", "con", "para", "por", "al", "los", "las", "a"]);
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));

const TOKENS_BAREMO = new Map<number, Set<string>>(BAREMO.map((b) => [b.id, new Set(tokens(b.descripcion))]));

export function porId(id: number): ItemBaremo | undefined {
  return BAREMO.find((b) => b.id === id);
}

/** Candidatos por similitud de palabras (Jaccard). Devuelve varios: los duplicados se desambiguan arriba. */
export function candidatos(descripcion: string, max = 6): ItemBaremo[] {
  const q = new Set(tokens(descripcion));
  if (q.size === 0) return [];
  const puntuados = BAREMO.map((b) => {
    const t = TOKENS_BAREMO.get(b.id)!;
    let inter = 0;
    for (const x of q) if (t.has(x)) inter++;
    const union = q.size + t.size - inter;
    return { b, score: union === 0 ? 0 : inter / union };
  })
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score);
  // Quita repetidos exactos de (descripcion normalizada, pu).
  const visto = new Set<string>();
  const out: ItemBaremo[] = [];
  for (const { b } of puntuados) {
    const k = `${norm(b.descripcion)}|${b.pu}`;
    if (visto.has(k)) continue;
    visto.add(k);
    out.push(b);
    if (out.length >= max) break;
  }
  return out;
}
