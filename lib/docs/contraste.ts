/** Luminancia relativa WCAG de un color #rrggbb. */
export function luminancia(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const TEXTO_OSCURO = "#111827";
export const TEXTO_CLARO = "#ffffff";

/** Razón de contraste WCAG entre dos colores. */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Color de texto con mejor contraste sobre un relleno: blanco sobre títulos oscuros (azul marino) y casi negro sobre claros. */
export function colorSobre(fondo?: string): string {
  if (!fondo || !/^#[0-9a-f]{6}$/i.test(fondo)) return TEXTO_OSCURO;
  return contraste(TEXTO_CLARO, fondo) > contraste(TEXTO_OSCURO, fondo) ? TEXTO_CLARO : TEXTO_OSCURO;
}
