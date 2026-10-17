import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { esEscaneado, textoPdf } from "./pdf";

const exec = promisify(execFile);

/** Documento tal como lo subió el usuario, en cualquier formato. */
export type Fuente = { nombre: string; mime: string; contenido: Buffer };

export type Formato = "pdf" | "docx" | "xlsx" | "texto" | "imagen" | "desconocido";

/** Lo que se pudo leer sin IA. `legible` es false para imágenes y PDF escaneados: ahí hace falta visión. */
export type Lectura = { formato: Formato; paginas: string[]; texto: string; legible: boolean };

export const formatoDe = (nombre: string, mime = ""): Formato => {
  const n = nombre.toLowerCase();
  if (/\.pdf$/.test(n) || mime === "application/pdf") return "pdf";
  if (/\.docx?$/.test(n)) return "docx";
  if (/\.xlsx?$/.test(n)) return "xlsx";
  if (/\.(txt|csv)$/.test(n) || mime.startsWith("text/")) return "texto";
  if (/\.(jpe?g|png|webp|gif|bmp|tiff?)$/.test(n) || mime.startsWith("image/")) return "imagen";
  return "desconocido";
};

function rutaSoffice(): string | null {
  const candidatas = [process.env.SOFFICE_PATH, "soffice", "libreoffice", "C:/Program Files/LibreOffice/program/soffice.exe"].filter(Boolean) as string[];
  for (const c of candidatas) if (spawnSync(c, ["--version"], { timeout: 15000 }).status === 0) return c;
  return null;
}

/** Los formatos binarios antiguos (.doc, .xls) se convierten con LibreOffice a su versión moderna; sin él se avisa con claridad. */
export async function modernizar(f: Fuente): Promise<Fuente> {
  const m = /\.(doc|xls)$/i.exec(f.nombre);
  if (!m) return f;
  const destino = m[1].toLowerCase() === "doc" ? "docx" : "xlsx";
  const soffice = rutaSoffice();
  if (!soffice) throw new Error(`«${f.nombre}» es un formato antiguo (.${m[1]}) y este servidor no tiene LibreOffice para convertirlo: guárdalo como .${destino} o PDF y súbelo de nuevo.`);
  const dir = await mkdtemp(join(tmpdir(), "cesar-conv-"));
  try {
    await writeFile(join(dir, `origen.${m[1].toLowerCase()}`), f.contenido);
    await exec(soffice, ["--headless", "--convert-to", destino, "--outdir", dir, join(dir, `origen.${m[1].toLowerCase()}`)], { timeout: 120000 });
    const buf = await readFile(join(dir, `origen.${destino}`));
    return { nombre: f.nombre.replace(/\.(doc|xls)$/i, `.${destino}`), mime: "", contenido: buf };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Word → texto conservando las tablas como filas «celda | celda»: así las filas de un informe siguen siendo líneas. */
async function textoDeWord(buf: Buffer): Promise<string> {
  const html = (await mammoth.convertToHtml({ buffer: buf })).value;
  return html
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<\/(tr|p|h[1-6]|li)>/gi, String.fromCharCode(10))
    .replace(/<br\s*\/?>/gi, String.fromCharCode(10))
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/ \| (?=\n)/g, "")
    .split(String.fromCharCode(10))
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join(String.fromCharCode(10));
}

async function textoDeExcel(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const out: string[] = [];
  for (const ws of wb.worksheets) {
    out.push(`# Hoja ${ws.name}`);
    ws.eachRow((row) => {
      const celdas: string[] = [];
      row.eachCell({ includeEmpty: false }, (c) => {
        const v = c.value;
        const x = v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v;
        celdas.push(x instanceof Date ? x.toISOString().slice(0, 10) : x == null ? "" : typeof x === "object" && "richText" in (x as object) ? (x as { richText: { text: string }[] }).richText.map((t) => t.text).join("") : String(x));
      });
      const linea = celdas.join(" | ").trim();
      if (linea) out.push(linea);
    });
  }
  return out.join(String.fromCharCode(10));
}

/** Lee el texto de un documento en cualquier formato sin usar IA. Las imágenes y los PDF escaneados quedan como no legibles (visión). */
export async function leerTexto(entrada: Fuente): Promise<Lectura> {
  const f = await modernizar(entrada);
  const formato = formatoDe(f.nombre, f.mime);
  switch (formato) {
    case "pdf": {
      const paginas = await textoPdf(f.contenido);
      return { formato, paginas, texto: paginas.join(String.fromCharCode(10)), legible: !esEscaneado(paginas) };
    }
    case "docx": {
      const texto = await textoDeWord(f.contenido);
      return { formato, paginas: [texto], texto, legible: texto.length > 20 };
    }
    case "xlsx": {
      const texto = await textoDeExcel(f.contenido);
      return { formato, paginas: [texto], texto, legible: texto.length > 20 };
    }
    case "texto": {
      const texto = f.contenido.toString("utf8");
      return { formato, paginas: [texto], texto, legible: texto.trim().length > 20 };
    }
    case "imagen":
      return { formato, paginas: [], texto: "", legible: false };
    default:
      throw new Error(`No se reconoce el formato de «${f.nombre}».`);
  }
}
