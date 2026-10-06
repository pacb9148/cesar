/**
 * Evaluador de las fórmulas sencillas de la planilla de ajuste (suma, resta, producto, división, potencia, paréntesis, referencias a
 * celdas y rangos —también de otras hojas— y SUM/ROUND/MIN/MAX/ABS/AVERAGE). No usa eval: es un analizador propio. Lo que no
 * reconoce devuelve null y la celda conserva su último valor calculado.
 */
export type ValorCelda = unknown;
export type LectorCeldas = (hoja: string | null, col: number, fila: number) => ValorCelda;

export const colANumero = (c: string): number => c.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const numeroACol = (n: number): string => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

const REF = String.raw`\$?[A-Z]{1,3}\$?\d+`;
const TOKEN = new RegExp(String.raw`\s*(?:(\d+(?:\.\d+)?)|((?:'[^']+'|[A-Za-z_][\w.]*)!)?(${REF})(?::(${REF}))?|([A-Z]+)(?=\()|(.))`, "y");

type Tok = { t: "num"; n: number } | { t: "ref"; hoja: string | null; a: string; b?: string } | { t: "fn"; n: string } | { t: "op"; c: string };

function tokenizar(f: string): Tok[] | null {
  const out: Tok[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < f.length) {
    const m = TOKEN.exec(f);
    if (!m) return null;
    if (m[1] !== undefined) out.push({ t: "num", n: Number(m[1]) });
    else if (m[3] !== undefined) out.push({ t: "ref", hoja: m[2] ? m[2].slice(0, -1).replace(/^'|'$/g, "") : null, a: m[3].replace(/\$/g, ""), b: m[4]?.replace(/\$/g, "") });
    else if (m[5] !== undefined) out.push({ t: "fn", n: m[5] });
    else if (m[6] !== undefined && m[6].trim() !== "") out.push({ t: "op", c: m[6] });
    else if (m[6] === undefined) return null;
  }
  return out;
}

const dirección = (a: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(a)!;
  return { col: colANumero(m[1]), fila: Number(m[2]) };
};
const comoNumero = (v: ValorCelda): number => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v) return comoNumero((v as { result: unknown }).result);
  return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0;
};

/** Valor de la fórmula, o null si no se pudo calcular. Una fórmula que es solo una referencia devuelve el valor tal cual (p. ej. una fecha). */
export function evaluarFormula(formula: string, hojaActual: string, leer: LectorCeldas): ValorCelda | null {
  const toks = tokenizar(formula.replace(/^=/, "").trim());
  if (!toks || toks.length === 0) return null;
  if (toks.length === 1 && toks[0].t === "ref" && !toks[0].b) {
    const d = dirección(toks[0].a);
    const v = leer(toks[0].hoja ?? hojaActual, d.col, d.fila);
    return v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : (v ?? null);
  }
  let p = 0;
  let falla = false;
  const ver = () => toks[p];
  const op = (c: string) => {
    const t = ver();
    if (t && t.t === "op" && t.c === c) {
      p++;
      return true;
    }
    return false;
  };
  const valoresDeRef = (t: Extract<Tok, { t: "ref" }>): number[] => {
    const h = t.hoja ?? hojaActual;
    const a = dirección(t.a);
    const b = t.b ? dirección(t.b) : a;
    const out: number[] = [];
    for (let f = Math.min(a.fila, b.fila); f <= Math.max(a.fila, b.fila); f++) for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) out.push(comoNumero(leer(h, c, f)));
    return out;
  };
  const primario = (): number => {
    const t = toks[p++];
    if (!t) {
      falla = true;
      return 0;
    }
    if (t.t === "num") return t.n;
    if (t.t === "ref") return valoresDeRef(t).reduce((s, x) => s + x, 0);
    if (t.t === "fn") {
      if (!op("(")) {
        falla = true;
        return 0;
      }
      const args: number[][] = [];
      if (!op(")")) {
        do {
          const ini = p;
          const a = toks[ini];
          // Un rango o una referencia suelta como argumento aporta todos sus valores (SUM(F12:F59)).
          if (a && a.t === "ref" && toks[ini + 1] && toks[ini + 1].t === "op" && ((toks[ini + 1] as { c: string }).c === "," || (toks[ini + 1] as { c: string }).c === ")")) {
            p++;
            args.push(valoresDeRef(a));
          } else args.push([suma()]);
        } while (op(","));
        if (!op(")")) falla = true;
      }
      const todos = args.flat();
      switch (t.n) {
        case "SUM": return todos.reduce((s, x) => s + x, 0);
        case "MIN": return todos.length ? Math.min(...todos) : 0;
        case "MAX": return todos.length ? Math.max(...todos) : 0;
        case "AVERAGE": return todos.length ? todos.reduce((s, x) => s + x, 0) / todos.length : 0;
        case "ABS": return Math.abs(todos[0] ?? 0);
        case "ROUND": {
          const k = 10 ** (todos[1] ?? 0);
          return Math.round((todos[0] ?? 0) * k) / k;
        }
        default:
          falla = true;
          return 0;
      }
    }
    if (t.c === "(") {
      const v = suma();
      if (!op(")")) falla = true;
      return v;
    }
    falla = true;
    return 0;
  };
  const unario = (): number => {
    if (op("-")) return -unario();
    if (op("+")) return unario();
    const base = primario();
    return op("^") ? base ** unario() : base;
  };
  const producto = (): number => {
    let v = unario();
    for (;;) {
      if (op("*")) v *= unario();
      else if (op("/")) {
        const d = unario();
        if (d === 0) falla = true;
        v = d === 0 ? 0 : v / d;
      } else return v;
    }
  };
  function suma(): number {
    let v = producto();
    for (;;) {
      if (op("+")) v += producto();
      else if (op("-")) v -= producto();
      else return v;
    }
  }
  const r = suma();
  return falla || p < toks.length || !Number.isFinite(r) ? null : r;
}
