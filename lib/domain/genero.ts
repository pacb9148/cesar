/** Tratamiento del asegurado en el informe: «el Sr.» o «la Sra.», deducido del nombre y corregible por el usuario. */
export type Genero = "m" | "f";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zñ ]/g, " ").trim();

// Nombres de pila femeninos que no terminan en «a» (los terminados en «a» se resuelven por la terminación).
const FEMENINOS = new Set(["rocio", "carmen", "mercedes", "soledad", "beatriz", "raquel", "ines", "isabel", "pilar", "dolores", "consuelo", "belen", "luz", "paz", "noemi", "esther", "jazmin", "karen", "yasmin", "ingrid", "marisol", "maribel", "amparo", "socorro", "rosario", "angeles", "guadalupe", "monserrat", "araceli", "ruth", "abigail", "elizabeth", "liz", "miriam", "judith", "edith", "nicol", "nicole", "lourdes", "irene", "yolanda", "maite", "dayana", "jocelyn", "scarlet", "ivonne", "viviane", "mabel", "maryori", "melany", "estefany", "francis", "ximena", "jennifer", "stephanie", "fabiola", "gisselle", "giselle", "marlene", "cindy", "kimberly", "priscila", "daniela", "yenny", "romina"]);
// Nombres de pila masculinos que terminan en «a».
const MASCULINOS_A = new Set(["joshua", "luca", "borja", "jose maria", "elias", "matias", "tobias", "zacarias", "isaias", "jeremias", "nicolas", "andrea ", "garcia", "bautista", "bonifacio", "gaspar", "mauricio", "costa"]);
const MASCULINOS = new Set(["andres", "jesus", "cristian", "christian", "sebastian", "adrian", "ivan", "joaquin", "ruben", "efrain", "benjamin", "ian", "jordan", "jonathan", "brayan", "bryan", "kevin", "dylan", "nahuel", "miguel", "angel", "manuel", "rafael", "gabriel", "daniel", "samuel", "emanuel", "israel", "abel", "ariel", "mikel", "raul", "saul", "paul", "luis", "carlos", "juan", "jose", "pedro", "pablo"]);

const porToken = (t: string): Genero | null => {
  if (FEMENINOS.has(t)) return "f";
  if (MASCULINOS.has(t) || MASCULINOS_A.has(t)) return "m";
  if (/a$/.test(t)) return "f";
  if (/(o|os|n|r|s|l|d|z|e|k|j|x|t|b|g)$/.test(t)) return "m";
  return null;
};

/** Género más probable según el primer nombre de pila (y el segundo si el primero no se puede decidir); null si no hay forma razonable. */
export function generoPorNombre(nombreCompleto: string): Genero | null {
  for (const t of norm(nombreCompleto).split(/\s+/).filter(Boolean).slice(0, 2)) {
    const g = porToken(t);
    if (g) return g;
  }
  return null;
}

export const tratamiento = (g: Genero): string => (g === "f" ? "la Sra." : "el Sr.");

/** Tratamiento a usar: el elegido por el usuario, o el deducido del nombre (el Sr. si no se puede decidir). */
export const tratamientoDe = (nombre: string, elegido?: Genero | null): string => tratamiento(elegido ?? generoPorNombre(nombre) ?? "m");

/** Número escrito por una persona en formato chileno o con punto decimal: «40.844,79», «40844.79», «1.294» (miles) o «1294,5». */
export function numeroFlexible(texto: string): number {
  const t = texto.replace(/[$\s]/g, "");
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, "")); // solo puntos de miles
  return Number(t);
}
