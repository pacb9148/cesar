// Prueba de punta a punta contra el servidor local: sube un caso real, lo procesa, carga un ajuste de
// referencia (la planilla emitida) por la ruta manual, genera los documentos y los descarga a tmp/e2e.
// Uso: tsx scripts/e2e.mts <prefijo-del-caso> [url]   (p. ej. 1981023)
import { globSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { leerPlanilla } from "../lib/extraccion/planilla";
import { BAREMO } from "../lib/engine/baremo";
import { textoPdf } from "../lib/extraccion/pdf";
import { parsearPresupuestoPdf, parsearPresupuestoXlsx } from "../lib/extraccion/presupuesto";
import { CLAVES_CARACTERISTICAS, type SalidaAgente } from "../lib/domain/tipos";

const prefijo = process.argv[2] ?? "1981023";
const base = process.argv[3] ?? "http://localhost:3010";
const dir = globSync(`fuente/${prefijo}*`)[0];
let cookie = "";

async function api(ruta: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>), cookie };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const r = await fetch(base + ruta, { ...init, headers, body });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return r;
}

/** Las operaciones largas responden en flujo (una línea JSON por evento): el resultado es la línea «fin» y los fallos llegan como «falla». */
async function resultadoDeFlujo<T>(r: Response): Promise<T & { error?: string }> {
  const texto = await r.text();
  for (const l of texto.trim().split("\n").reverse()) {
    try {
      const m = JSON.parse(l) as { fin?: T; falla?: string; error?: string };
      if (m.fin !== undefined) return m.fin as T & { error?: string };
      if (m.falla || m.error) return { error: m.falla ?? m.error } as T & { error?: string };
    } catch {
      /* línea de traza parcial */
    }
  }
  return { error: `Respuesta sin resultado (HTTP ${r.status})` } as T & { error?: string };
}

function archivos(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}

const reg = await api("/api/auth/registro", { method: "POST", json: { email: "e2e@cesar.local", nombre: "Prueba E2E", clave: "clave-de-prueba-2026" } });
console.log("registro", reg.status);
if (reg.status === 403) {
  const l = await api("/api/auth/login", { method: "POST", json: { email: "e2e@cesar.local", clave: "clave-de-prueba-2026" } });
  console.log("login", l.status);
}
const { id } = (await (await api("/api/casos", { method: "POST" })).json()) as { id: string };
console.log("caso", id);

const todos = archivos(dir).filter((f) => /\.(pdf|xlsx|docx|jpe?g|png)$/i.test(f) && !/Ajuste|INFORME FINAL|borrador|Anexo/i.test(f));
for (let i = 0; i < todos.length; i += 15) {
  const f = new FormData();
  for (const p of todos.slice(i, i + 15)) {
    f.append("archivos", new File([new Uint8Array(readFileSync(p))], p.split(/[\\/]/).pop()!, { type: /\.pdf$/i.test(p) ? "application/pdf" : /\.xlsx$/i.test(p) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : /\.docx$/i.test(p) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "image/jpeg" }));
    f.append("rutas", relative(dir, p).replace(/\\/g, "/"));
  }
  const r = await api(`/api/casos/${id}/archivos`, { method: "POST", body: f });
  if (!r.ok) throw new Error(`subida ${r.status}: ${await r.text()}`);
}
console.log("archivos subidos:", todos.length);

const proc = await resultadoDeFlujo<{ alertas: string[]; archivosLeidos: string[]; partidas: number }>(await api(`/api/casos/${id}/procesar`, { method: "POST" }));
console.log("procesar:", proc.error ?? { leidos: proc.archivosLeidos, partidas: proc.partidas, alertas: proc.alertas });

await api(`/api/casos/${id}/datos`, { method: "PATCH", json: { denunciaTexto: "Producto del riesgo de la naturaleza la vivienda sufre daños en su infraestructura", fechas: { emision: "24/08/2026", informadoPartes: "22/08/2026" } } });

// Ajuste de referencia (planilla emitida) como si lo hubiera entregado el perito.
const ref = globSync(`fuente/${prefijo}*/*Ajuste*[vV]1.xlsx`)[0] ?? globSync(`fuente/${prefijo}*/Ajuste*.xlsx`)[0];
const p = await leerPlanilla(ref);
const falt = { valor: null, estado: "faltante" as const, evidencia: [] };
// Sin presupuesto (pérdida determinada): la planilla de una sola columna aporta las partidas propias del perito.
const hayPresupuesto = !!(globSync(`fuente/${prefijo}*/DOCUMENTOS/*`)[0]);
if (!hayPresupuesto) {
  p.adicionales = p.reclamacion.lineas.map((l) => ({
    seccion: l.recinto, descripcion: l.descripcion, um: l.um, cantidad: l.cantidad, pu: l.pu,
    pu_origen: BAREMO.find((x) => x.pu === l.pu) ? `baremo:${BAREMO.find((x) => x.pu === l.pu)!.id}` : "mercado:planilla de referencia",
    obs: ["B" as const], justificacion: "Partida valorizada por el perito según el acta",
  }));
  p.decisiones = [];
} else {
// La numeración de partidas sale del presupuesto leído por el sistema (puede diferir de la planilla emitida): se cruza por orden.
const pres = globSync(`fuente/${prefijo}*/DOCUMENTOS/*Presupuesto*.xlsx`)[0]
  ? await parsearPresupuestoXlsx(readFileSync(globSync(`fuente/${prefijo}*/DOCUMENTOS/*Presupuesto*.xlsx`)[0]))
  : parsearPresupuestoPdf(await textoPdf(readFileSync(globSync(`fuente/${prefijo}*/DOCUMENTOS/*.pdf`).find((x) => /Presupuesto|_-/.test(x))!)));
const items = pres.reclamacion.lineas.map((l) => l.item);
if (items.length === p.decisiones.length) p.decisiones.forEach((d, i) => (d.item = items[i]));
}
const salida: SalidaAgente = {
  caracteristicas: Object.fromEntries(CLAVES_CARACTERISTICAS.map((k) => [k, falt])) as unknown as SalidaAgente["caracteristicas"],
  evidencia_observada: [{ recinto: "Cubierta", vineta: "desanclaje de cubierta y levantamiento de hojalatería.", m2_acta: 50, atribuible: true, fotos: [] }],
  lineas: p.decisiones.map((d) => {
    const b = BAREMO.find((x) => x.pu === d.pu);
    const obs = d.cantidad === 0 ? ["A" as const] : d.obs.length ? d.obs.map((o) => (o === "C" ? "B" : o)) : ["B" as const];
    return { ...d, obs: obs as typeof d.obs, pu_origen: b ? `baremo:${b.id}` : "mercado:planilla de referencia", justificacion: "Ajuste según planilla de referencia" };
  }),
  lineas_adicionales: p.adicionales,
  ajuste_de_perdida_texto: "Sin perjuicio de la reclamación presentada, se revisó que los valores unitarios se ajustaran a precios de mercado y las cantidades a las cubicaciones efectuadas in situ.",
  resumen_ajuste: ["Cantidades recortadas al acta (C).", "Precios llevados a baremo a todo costo (B).", "Faenas absorbidas en gastos generales (E)."],
  faltantes: [],
};
const put = await api(`/api/casos/${id}/ajuste`, { method: "PUT", json: salida });
console.log("ajuste manual:", put.status, put.status === 200 ? "" : await put.text());

// Edición de fotos: se eligen 3 para el informe, una con zoom, giro y volteo; deben ser exactamente las que aparecen.
const listado = (await (await api(`/api/casos/${id}/archivos`)).json()) as { id: string; tipo: string; nombre: string }[];
const fotosCaso = listado.filter((a) => a.tipo === "foto");
const edit = { giro: 90, volteoH: true, volteoV: false, zoom: 2, cx: 0.3, cy: 0.6, brillo: 10, contraste: 10, saturacion: 0, leyenda: "Leyenda editada", incluir: true };
for (const [i, f] of fotosCaso.slice(0, 3).entries()) {
  const r = await api(`/api/casos/${id}/archivos/${f.id}/edicion`, { method: "PUT", json: i === 0 ? edit : { ...edit, giro: 0, volteoH: false, zoom: 1, cx: 0.5, cy: 0.5, brillo: 0, contraste: 0, leyenda: undefined } });
  console.log("edición foto", i + 1, r.status);
}
const miniatura = await api(`/api/casos/${id}/archivos/${fotosCaso[0].id}?miniatura=1`);
console.log("miniatura:", miniatura.status, miniatura.headers.get("content-type"), (await miniatura.arrayBuffer()).byteLength, "bytes");

const t0 = Date.now();
const gen = await api(`/api/casos/${id}/generar`, { method: "POST" });
const g = await resultadoDeFlujo<{ entregables?: { id: string; nombre: string }[]; totales?: unknown; faltantes?: string[]; motorPdf?: string }>(gen);
console.log("generar:", gen.status, `${Math.round((Date.now() - t0) / 1000)} s`, g.error ?? { totales: g.totales, faltantes: g.faltantes, motorPdf: g.motorPdf });
mkdirSync("tmp/e2e", { recursive: true });
for (const e of g.entregables ?? []) {
  const r = await api(`/api/casos/${id}/archivos/${e.id}?descargar=1`);
  writeFileSync(join("tmp/e2e", e.nombre), Buffer.from(await r.arrayBuffer()));
  console.log("  →", e.nombre);
}

// Comprobación del informe: solo las 3 fotos elegidas (+ la fachada de cabecera, si hay) y con la leyenda editada.
import PizZip from "pizzip";
{
  const docx = new PizZip(readFileSync(join("tmp/e2e", `${(g.entregables ?? []).find((e) => /INFORME\.docx$/.test(e.nombre))?.nombre}`)));
  const xml = docx.file("word/document.xml")!.asText();
  const fotos = (xml.match(/<wp:extent cx="2808000" cy="2340000"\/>/g) ?? []).length;
  console.log("fotos 7,8×6,5 cm en el informe:", fotos, "(esperado 3, o 4 con fachada); leyenda editada:", xml.includes("Leyenda editada"));
}
