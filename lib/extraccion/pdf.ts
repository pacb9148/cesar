import { getDocumentProxy } from "unpdf";

type Item = { str: string; transform: number[]; width?: number };

/**
 * Texto por página reconstruido por posición: agrupa los fragmentos que comparten línea (misma Y)
 * y los ordena por X. El orden "de lectura" interno del PDF no es fiable: en tablas deja las
 * etiquetas lejos de sus importes.
 */
export async function textoPdf(buf: Buffer | Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const paginas: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const { items } = await page.getTextContent();
    const frag = (items as Item[])
      .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
      .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0 }));
    frag.sort((a, b) => b.y - a.y || a.x - b.x);
    const lineas: { y: number; f: typeof frag }[] = [];
    for (const f of frag) {
      const l = lineas.find((z) => Math.abs(z.y - f.y) <= 2.5);
      if (l) l.f.push(f);
      else lineas.push({ y: f.y, f: [f] });
    }
    lineas.sort((a, b) => b.y - a.y);
    paginas.push(
      lineas
        .map((l) => {
          l.f.sort((a, b) => a.x - b.x);
          let out = "";
          let finPrev = -Infinity;
          for (const f of l.f) {
            if (out && f.x - finPrev > 1.5) out += " ";
            out += f.s;
            finPrev = f.x + f.w;
          }
          return out.replace(/\s+/g, " ").trim();
        })
        .join("\n"),
    );
  }
  return paginas;
}

/** Menos de ~40 caracteres útiles por página sugiere un escaneo que necesita OCR con visión. */
export const esEscaneado = (paginas: string[]) =>
  paginas.reduce((s, p) => s + p.replace(/\s/g, "").length, 0) / Math.max(1, paginas.length) < 40;
