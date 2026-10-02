import { chromium, type Browser } from "playwright-core";
import { existsSync } from "node:fs";

const RUTAS_LOCALES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** Chromium para capturas y PDF: @sparticuz/chromium en Vercel, Chrome/Edge instalado en local. */
export async function lanzarNavegador(): Promise<Browser> {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const ch = (await import("@sparticuz/chromium")).default;
    return chromium.launch({ args: ch.args, executablePath: await ch.executablePath(), headless: true });
  }
  const ruta = [process.env.CHROME_PATH, ...RUTAS_LOCALES].find((r) => r && existsSync(r));
  if (!ruta) throw new Error("No se encontró Chrome/Edge: define CHROME_PATH en .env.local");
  return chromium.launch({ executablePath: ruta, headless: true });
}

export async function htmlAPng(html: string, ancho: number, escala = 2): Promise<Buffer> {
  const b = await lanzarNavegador();
  try {
    const page = await b.newPage({ viewport: { width: ancho, height: 800 }, deviceScaleFactor: escala });
    await page.setContent(html, { waitUntil: "load" });
    const png = await page.locator("body").screenshot({ type: "png" });
    return Buffer.from(png);
  } finally {
    await b.close();
  }
}

export async function htmlAPdf(html: string): Promise<Buffer> {
  const b = await lanzarNavegador();
  try {
    const page = await b.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "Letter", printBackground: true, margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" } });
    return Buffer.from(pdf);
  } finally {
    await b.close();
  }
}
