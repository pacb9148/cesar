import type { Page } from "playwright-core";
import { lanzarNavegador } from "../docs/navegador";

const SITIO = "https://agrometeorologia.cl/";

export type Estacion = { id: string; nombre: string; comuna: string; region: string; lat: number; lon: number; sigla: string };

export type DiaMeteo = { fecha: string; precipitacionMm: number | null; vientoKmh: number | null; rafagaKmh: number | null };

export type ResultadoMeteo = {
  estacion: Estacion;
  distanciaKm: number;
  dia: DiaMeteo;
  imagenPng: Buffer;
};

const rad = (g: number) => (g * Math.PI) / 180;
export function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function masCercanas<T extends { lat: number; lon: number }>(punto: { lat: number; lon: number }, est: T[], n = 3) {
  return est
    .map((e) => ({ e, km: distanciaKm(punto, e) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

/** Una consulta a Nominatim (OSM). Uso bajo y con User-Agent propio, como exige su política de uso. */
async function nominatim(q: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cl&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { "User-Agent": "cesar-ajustador/1.0 (liquidacion de siniestros)" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const j = (await r.json()) as { lat: string; lon: string }[];
  return j[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon) } : null;
}

/**
 * Geocodifica la dirección del riesgo; si OSM no conoce la calle, se afloja la consulta paso a paso
 * (sin número, solo calle y comuna, solo comuna). La estación se elige por cercanía, así que basta con la comuna.
 */
export async function geocodificar(direccion: string): Promise<{ lat: number; lon: number } | null> {
  const partes = direccion.split(",").map((x) => x.trim()).filter(Boolean);
  const calle = partes[0] ?? "";
  const resto = partes.slice(1).join(", ");
  const intentos = [
    direccion,
    `${calle.replace(/\s+\d+\s*$/, "").replace(/^Pje\.?\s/i, "Pasaje ").replace(/^Av\.?\s/i, "Avenida ")}, ${resto}`,
    resto,
    partes.slice(-2).join(", "),
  ];
  for (const q of [...new Set(intentos)].filter(Boolean)) {
    const r = await nominatim(q.endsWith("Chile") ? q : `${q}, Chile`);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 1100)); // 1 consulta por segundo
  }
  return null;
}

type FilaApi = { id: string; nombre: string; comuna: string; region: string; latitud: string; longitud: string; institucion_sigla: string };

/** El listado de estaciones lo pide la propia página con un token temporal: se captura la respuesta. */
export async function listarEstaciones(page: Page): Promise<Estacion[]> {
  const espera = page.waitForResponse((r) => /items-resumen\.json/.test(r.url()), { timeout: 45000 });
  await page.goto(SITIO, { waitUntil: "domcontentloaded" });
  const resp = await espera;
  const filas = (await resp.json()) as FilaApi[];
  return filas
    .map((f) => ({
      id: f.id,
      nombre: f.nombre,
      comuna: f.comuna,
      region: f.region,
      lat: Number(f.latitud),
      lon: Number(f.longitud),
      sigla: f.institucion_sigla,
    }))
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon));
}

/** Valor del <select> de estaciones ("INIA-351", "EXT-163") para una estación del listado. */
export async function valorSelect(page: Page, e: Estacion): Promise<string | null> {
  return page.evaluate(
    ({ nombre, id }) => {
      const op = [...(document.querySelector("#estaciones") as HTMLSelectElement).options].find(
        (o) => o.value.endsWith(`-${id}`) && o.text.trim().toLowerCase().startsWith(nombre.trim().toLowerCase()),
      );
      return op?.value ?? null;
    },
    { nombre: e.nombre, id: e.id },
  );
}

/** Envía el formulario de consulta del sitio (POST) con la serie diaria del mes. */
async function consultarMes(page: Page, valor: string, fechaIso: string) {
  const [anio, mes] = fechaIso.split("-");
  const ultimo = new Date(Number(anio), Number(mes), 0).getDate();
  const navegacion = page.waitForNavigation({ waitUntil: "load", timeout: 45000 });
  await page.evaluate(
    ({ valor, anio, mes, ultimo }) => {
      const campos: [string, string][] = [
        ["estaciones[]", valor],
        ["variables[]", "PP_SUM"],
        ["variables[]", "VV_AVG"],
        ["variables[]", "VV_MAX"],
        ["intervalo", "day"],
        ["desde", `${anio}-${mes}-01`],
        ["hasta", `${anio}-${mes}-${String(ultimo).padStart(2, "0")}`],
        ["month_desde", "1"],
        ["month_hasta", "1"],
        ["yearMonth_desde", anio],
        ["yearMonth_hasta", anio],
        ["year_desde", `${anio}-01-01`],
        ["year_hasta", `${anio}-12-31`],
        ["vista[]", "grafico"],
      ];
      const f = document.createElement("form");
      f.method = "POST";
      f.action = "/";
      for (const [n, v] of campos) {
        const i = document.createElement("input");
        i.type = "hidden";
        i.name = n;
        i.value = v;
        f.appendChild(i);
      }
      document.body.appendChild(f);
      f.submit();
    },
    { valor, anio, mes, ultimo },
  );
  await navegacion;
  await page.waitForFunction(
    // @ts-expect-error Chart lo define la página del sitio
    () => typeof Chart !== "undefined" && Object.keys(Chart.instances ?? {}).length > 0,
    undefined,
    { timeout: 30000 },
  );
}

/** Lee los datos que el sitio incrusta en la página de resultados. */
export function parsearSerie(html: string): DiaMeteo[] {
  const i = html.indexOf("/*DATOS*/");
  if (i < 0) return [];
  return html
    .slice(i)
    .split("tiempos.push(moment('")
    .slice(1)
    .map((p) => {
      const v = [...p.matchAll(/data\[i\]\.push\('([^']*)'\)/g)].map((m) => (m[1] === "" ? null : Number(m[1])));
      return { fecha: p.slice(0, 10), precipitacionMm: v[0] ?? null, vientoKmh: v[1] ?? null, rafagaKmh: v[2] ?? null };
    });
}

export async function capturarDia(page: Page, e: Estacion, fechaIso: string): Promise<{ dia: DiaMeteo; png: Buffer } | null> {
  const valor = await valorSelect(page, e);
  if (!valor) return null;
  await consultarMes(page, valor, fechaIso);
  const serie = parsearSerie(await page.content());
  const idx = serie.findIndex((d) => d.fecha === fechaIso);
  if (process.env.DEBUG_METEO) console.log("serie", serie.length, serie.slice(14, 17), idx);
  if (idx < 0 || serie[idx].precipitacionMm == null) return null;

  // Tooltip del día sobre el gráfico (Chart.js): se marca el gráfico de la consulta (el de 3 series)
  // y se posiciona el mouse sobre el punto de ese día.
  const punto = await page.evaluate((k) => {
    // @ts-expect-error Chart lo define la página del sitio
    const todos = Object.values(Chart.instances) as { data: { datasets: unknown[] }; canvas: HTMLCanvasElement; getDatasetMeta: (n: number) => { data: { _model?: { x: number; y: number }; x?: number; y?: number }[] } }[];
    const c = todos.find((i) => i.data.datasets.length >= 3) ?? todos[0];
    c.canvas.setAttribute("data-cesar", "grafico");
    const el = c.getDatasetMeta(0).data[k];
    return { x: el._model?.x ?? el.x ?? 0, y: el._model?.y ?? el.y ?? 0 };
  }, idx);
  const canvas = page.locator('canvas[data-cesar="grafico"]');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + punto.x, box.y + punto.y);
  await page.waitForTimeout(600);

  // Captura del gráfico (el tooltip se dibuja dentro del canvas) + logo oficial arriba, como en los informes emitidos.
  const grafico = Buffer.from(await canvas.screenshot({ type: "png" }));
  let png = grafico;
  try {
    const resp = await page.request.get(new URL("assets/img/logo-agrometeorologia.png", SITIO).toString());
    if (resp.ok()) {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(grafico).metadata();
      const logo = await sharp(Buffer.from(await resp.body())).resize({ height: 110 }).png().toBuffer();
      const lm = await sharp(logo).metadata();
      png = await sharp({ create: { width: meta.width!, height: meta.height! + lm.height! + 16, channels: 3, background: "#ffffff" } })
        .composite([
          { input: logo, left: 16, top: 8 },
          { input: grafico, left: 0, top: lm.height! + 16 },
        ])
        .png()
        .toBuffer();
    }
  } catch {
    /* sin logo: se entrega solo el gráfico */
  }
  return { dia: serie[idx], png };
}

/** Flujo completo: geocodifica, elige la estación más cercana con dato y captura el gráfico. */
export async function evidenciaMeteorologica(direccion: string, fechaIso: string): Promise<ResultadoMeteo | null> {
  const punto = await geocodificar(direccion);
  if (!punto) return null;
  const browser = await lanzarNavegador();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
    const estaciones = await listarEstaciones(page);
    for (const { e, km } of masCercanas(punto, estaciones, 5)) {
      await page.goto(SITIO, { waitUntil: "domcontentloaded" });
      const r = await capturarDia(page, e, fechaIso);
      if (r) return { estacion: e, distanciaKm: km, dia: r.dia, imagenPng: r.png };
    }
    return null;
  } finally {
    await browser.close();
  }
}
