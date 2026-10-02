import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";
import { lanzarNavegador } from "./navegador";

const exec = promisify(execFile);

export type MotorPdf = "libreoffice" | "html";

function rutaSoffice(): string | null {
  const candidatas = [process.env.SOFFICE_PATH, "soffice", "libreoffice", "C:\\Program Files\\LibreOffice\\program\\soffice.exe"].filter(Boolean) as string[];
  for (const c of candidatas) {
    const r = spawnSync(c, ["--version"], { timeout: 15000 });
    if (r.status === 0) return c;
  }
  return null;
}

/**
 * Convierte el .docx en PDF. Con LibreOffice el resultado es idéntico al Word (cabeceras, pies, versalitas).
 * Sin LibreOffice se usa una conversión a HTML + Chromium: conserva el contenido y las imágenes, no el formato exacto.
 */
export async function docxAPdf(docx: Buffer, pie = ""): Promise<{ pdf: Buffer; motor: MotorPdf }> {
  const soffice = rutaSoffice();
  if (soffice) {
    const dir = await mkdtemp(join(tmpdir(), "cesar-pdf-"));
    try {
      await writeFile(join(dir, "informe.docx"), docx);
      await exec(soffice, ["--headless", "--convert-to", "pdf", "--outdir", dir, join(dir, "informe.docx")], { timeout: 120000 });
      return { pdf: await readFile(join(dir, "informe.pdf")), motor: "libreoffice" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const r = await mammoth.convertToHtml(
    { buffer: docx },
    { convertImage: mammoth.images.imgElement(async (img) => ({ src: `data:${img.contentType};base64,${await img.readAsBase64String()}` })) },
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:12pt "Times New Roman",Liberation Serif,serif;color:#000;text-align:justify;line-height:1.25}
    table{border-collapse:collapse;width:100%} td{vertical-align:top;padding:1px 4px}
    img{max-width:100%;height:auto} p{margin:0 0 .6em}
  </style></head><body>${r.value}</body></html>`;
  const b = await lanzarNavegador();
  try {
    const page = await b.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "20mm", bottom: "22mm", left: "18mm", right: "18mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font:9px serif;width:100%;padding:0 18mm;display:flex;justify-content:space-between;color:#1f4e79"><span>${pie}</span><span>Beckett S.A. Liquidadores de Seguros</span><span>Página <span class="pageNumber"></span></span></div>`,
    });
    return { pdf: Buffer.from(pdf), motor: "html" };
  } finally {
    await b.close();
  }
}
