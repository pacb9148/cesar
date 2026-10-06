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

// ---- Edición completa: Excel → cuadro y totales del Word; foto → informe y anexo; formato en el Word; PDF exacto ----
{
  const lista = async () => (await (await api(`/api/casos/${id}/archivos`)).json()) as { id: string; nombre: string; tipo: string; tamano: number }[];
  const bajar = async (aid: string) => Buffer.from(await (await api(`/api/casos/${id}/archivos/${aid}?descargar=1`)).arrayBuffer());
  const textoWord = (b: Buffer) => new PizZip(b).file("word/document.xml")!.asText();
  let sal = (await lista()).filter((a) => a.tipo === "salida");
  const xlsxId = sal.find((a) => /\.xlsx$/.test(a.nombre))!.id;
  const informeId = sal.find((a) => /INFORME\.docx$/.test(a.nombre))!.id;
  const antesWord = textoWord(await bajar(informeId));

  // 1. Editar una cantidad en el Excel.
  const vx = (await (await api(`/api/casos/${id}/archivos/${xlsxId}/vista`)).json()) as { hojas: { nombre: string; celdas: { r: number; c: number; raw: string; f?: string }[] }[] };
  const celda = vx.hojas.find((h) => h.nombre === "EDIFICIO")!.celdas.find((c) => c.c === 8 && c.r > 11 && !c.f && Number(c.raw) > 0)!;
  const rx = await api(`/api/casos/${id}/archivos/${xlsxId}/vista`, { method: "PUT", json: { celdas: [{ hoja: "EDIFICIO", r: celda.r, c: 8, valor: "0" }] } });
  const jx = (await rx.json()) as { avisos?: string[]; error?: string };
  console.log("excel editado:", rx.status, jx.error ?? jx.avisos);
  const despuesWord = textoWord(await bajar(informeId));
  const marcas = (x: string) => (x.match(/46,73/g) ?? []).length;
  console.log("cuadro y totales del Word al editar el Excel → cambió:", despuesWord !== antesWord, "| «46,73» antes/después:", marcas(antesWord), "/", marcas(despuesWord), "| tabla del cuadro presente:", despuesWord.includes('w:tblCaption w:val="cuadro-de-perdida"'));

  // 2. Editar el recorte de una foto del informe: debe cambiar la imagen del Word y del anexo.
  const fotoElegida = fotosCaso[0];
  const imgDe = (b: Buffer, fid: string) => {
    const z = new PizZip(b);
    const x = z.file("word/document.xml")!.asText();
    const m = new RegExp(String.raw`name="foto:${fid}"[\s\S]*?r:embed="([^"]+)"`).exec(x);
    const rels = z.file("word/_rels/document.xml.rels")!.asText();
    const t = m && new RegExp(`Id="${m[1]}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${m[1]}"`).exec(rels);
    const destino = t && (t[1] ?? t[2]);
    return destino ? Buffer.from(z.file(`word/${destino}`)!.asUint8Array()) : null;
  };
  const antesImg = imgDe(await bajar(informeId), fotoElegida.id);
  const re = await api(`/api/casos/${id}/archivos/${fotoElegida.id}/edicion`, { method: "PUT", json: { ...edit, zoom: 3, cx: 0.8, cy: 0.2, giro: 0, volteoH: false, leyenda: "Otra leyenda" } });
  const je = (await re.json()) as { avisos?: string[] };
  const informe2 = await bajar(informeId);
  { const x = textoWord(informe2); const i = x.indexOf("foto:"); console.log("nombres foto: en el Word:", (x.match(/name="foto:/g) ?? []).length, "| contexto:", i < 0 ? "ninguno" : x.slice(i - 40, i + 380).replace(/\s+/g, " ")); }
  const despuesImg = imgDe(informe2, fotoElegida.id);
  console.log("foto editada → informe actualizado:", re.status, "| imagen distinta:", !!antesImg && !!despuesImg && !antesImg.equals(despuesImg), `(${antesImg?.length ?? "no encontrada"} → ${despuesImg?.length ?? "no encontrada"} bytes)`, "| leyenda nueva:", textoWord(informe2).includes("Otra leyenda"), "| avisos:", je.avisos);
  sal = (await lista()).filter((a) => a.tipo === "salida");
  const anexoXml = textoWord(await bajar(sal.find((a) => /^Anexo/.test(a.nombre))!.id));
  console.log("anexo regenerado con la foto:", anexoXml.includes(`foto:${fotoElegida.id}`), "| leyenda:", anexoXml.includes("Otra leyenda"));

  // 3. Formato en el Word (negrita) y PDF exacto.
  const vw = (await (await api(`/api/casos/${id}/archivos/${informeId}/vista`)).json()) as { bloques: unknown[] };
  type P = { tipo: "p"; i: number; texto: string; editable: boolean };
  const todos: P[] = [];
  const rec = (bs: unknown[]) => bs.forEach((b) => { const x = b as { tipo: string; filas?: { celdas: { bloques: unknown[] }[] }[] }; if (x.tipo === "p") todos.push(x as unknown as P); else x.filas?.forEach((f) => f.celdas.forEach((c) => rec(c.bloques))); });
  rec(vw.bloques);
  const p = todos.find((t) => t.editable && t.texto.length > 40)!;
  const rw = await api(`/api/casos/${id}/archivos/${informeId}/vista`, { method: "PUT", json: { word: { parrafos: { [p.i]: [{ t: "Texto " }, { t: "destacado", b: true }] }, insertar: [{ despuesDe: p.i, runs: [{ t: "Párrafo agregado por el usuario" }] }] } } });
  const zdoc = textoWord(await bajar(informeId));
  const vw2 = (await (await api(`/api/casos/${id}/archivos/${informeId}/vista`)).json()) as { bloques: unknown[] };
  const todos2: { runs: { t: string; b?: boolean }[]; texto: string }[] = [];
  const rec2 = (bs: unknown[]) => bs.forEach((b) => { const x = b as { tipo: string; filas?: { celdas: { bloques: unknown[] }[] }[] }; if (x.tipo === "p") todos2.push(x as never); else x.filas?.forEach((f) => f.celdas.forEach((c) => rec2(c.bloques))); });
  rec2(vw2.bloques);
  console.log("formato en el Word:", rw.status, "| negrita:", todos2.some((t) => t.runs.some((r) => r.t === "destacado" && r.b)), "| párrafo insertado:", zdoc.includes("Párrafo agregado por el usuario"));
  const pdf = await api(`/api/casos/${id}/archivos/${informeId}/vista?pdf=1`);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  console.log("PDF exacto (LibreOffice):", pdf.status, bytes.subarray(0, 5).toString(), Math.round(bytes.length / 1024), "KB");
}
