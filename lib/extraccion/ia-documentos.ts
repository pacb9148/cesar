import { z } from "zod";
import type { ClienteLlm, Parte } from "../ia/gemini";
import { esquemaParaGemini } from "../ia/gemini";
import { emitir } from "../traza";
import { leerTexto, formatoDe, modernizar, type Fuente } from "./universal";
import type { ActaInspeccion } from "./acta";
import { presupuestoDeEstructura, type ResultadoPresupuesto } from "./presupuesto";

const MAX_TEXTO = 60_000;
const NL = "\n";

/** Partes para el modelo: el texto cuando se pudo leer; la imagen o el PDF completo cuando es un escaneo (el modelo lo lee con visión). */
export async function partesDe(fuentes: Fuente[]): Promise<Parte[]> {
  const partes: Parte[] = [];
  for (const original of fuentes) {
    const f = await modernizar(original);
    const l = await leerTexto(f);
    if (l.legible) {
      partes.push({ text: `DOCUMENTO «${f.nombre}»:${NL}${l.texto.slice(0, MAX_TEXTO)}` });
      continue;
    }
    const mime = f.mime && f.mime !== "application/octet-stream" ? f.mime : formatoDe(f.nombre) === "pdf" ? "application/pdf" : "image/jpeg";
    partes.push({ text: `DOCUMENTO «${f.nombre}» (imagen o escaneo: léelo visualmente):` }, { inlineData: { mimeType: mime, data: f.contenido.toString("base64") } });
  }
  return partes;
}

function leerJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Pide al modelo un JSON con el esquema dado; si no cumple, se lo devuelve con los errores una vez más. */
export async function extraerEstructurado<T>(cliente: ClienteLlm, o: { system: string; instruccion: string; fuentes: Fuente[]; schema: z.ZodType<T> }): Promise<T> {
  const base: Parte[] = [{ text: o.instruccion }, ...(await partesDe(o.fuentes))];
  const schema = esquemaParaGemini(o.schema);
  let correcciones = "";
  for (let intento = 1; intento <= 2; intento++) {
    const partes = correcciones ? [...base, { text: `Tu respuesta anterior tenía errores; corrígelos y devuelve el JSON completo:${NL}${correcciones}` }] : base;
    const r = await cliente.generarJson({ system: o.system, partes, schema });
    const p = o.schema.safeParse(leerJson(r.texto));
    if (p.success) return p.data;
    correcciones = p.error.issues.slice(0, 12).map((x) => `${x.path.join(".")}: ${x.message}`).join(NL);
    emitir("error", "ia-documentos", `La lectura con IA no cumple el formato (${p.error.issues.length} problemas)`, correcciones);
  }
  throw new Error("La IA no devolvió una lectura válida del documento tras dos intentos.");
}

/* ------------------------------ Inspección ------------------------------ */

const num = z.number().nullable();
const txt = z.string().nullable();

export const actaIaSchema = z.object({
  siniestro: txt,
  caso: txt,
  compania: txt,
  asegurado: txt,
  rut: txt,
  direccionRiesgo: txt,
  comuna: txt,
  region: txt,
  fechaSiniestro: txt,
  fechaInspeccion: txt,
  inspector: txt,
  hechos: txt,
  causa: txt,
  tipoInmueble: txt,
  pisos: num,
  dormitorios: num,
  banos: num,
  superficieM2: num,
  antiguedad: num,
  sistemaEstructural: txt,
  estructuraTechumbre: txt,
  cubierta: txt,
  pavimentos: txt,
  danosEdificio: z.boolean().nullable(),
  danosContenido: z.boolean().nullable(),
  danos: z.array(z.object({ recinto: z.string(), alto: z.number(), ancho: z.number(), largo: z.number(), descripcion: z.string(), tipoDano: z.string(), um: z.string(), cantidad: z.number() })),
});

const SYSTEM_ACTA = [
  "Eres un asistente que lee informes de inspección de siniestros de seguros en Chile y extrae datos con exactitud.",
  "Reglas: usa SOLO lo que consta en el documento; si un dato no consta, devuelve null (no inventes ni deduzcas). Copia los textos tal cual, sin resumir.",
  "Fechas en formato dd-mm-aaaa. Números como número (punto decimal).",
].join(" ");

const INSTRUCCION_ACTA = [
  "Extrae del informe de inspección:",
  "- Datos generales (siniestro, caso, compañía, asegurado, RUT, dirección del riesgo, comuna, región, fechas, quién inspeccionó).",
  "- «hechos»: el texto del punto de los hechos. «causa»: el texto de la causa u origen de los daños (por ejemplo «Temporal viento y lluvia»).",
  "- Descripción del inmueble y de la construcción: tipo (Casa, Departamento…), pisos, dormitorios, baños, superficie construida en m2, antigüedad en años, sistema estructural, estructura de techumbre, cubierta, pavimentos, y si hay daños en edificio y en contenido.",
  "- «danos»: una entrada por cada fila de la tabla «Daños y perjuicios» (dependencia, alto, ancho, largo, descripción, tipo de daño, unidad y cantidad), en el mismo orden del documento.",
].join(NL);

export type ActaConExtras = ActaInspeccion & { causa?: string | null; tipoInmueble?: string | null };

/** Lectura con IA de una inspección en cualquier formato (imagen, escaneo, Word, Excel…): se usa cuando el lector determinista no reconoce el formato. */
export async function actaConIa(cliente: ClienteLlm, fuentes: Fuente[]): Promise<ActaConExtras> {
  return extraerEstructurado(cliente, { system: SYSTEM_ACTA, instruccion: INSTRUCCION_ACTA, fuentes, schema: actaIaSchema });
}

/* ------------------------------ Presupuesto ------------------------------ */

const presupuestoIaSchema = z.object({
  secciones: z.array(z.object({ titulo: z.string(), partidas: z.array(z.object({ descripcion: z.string(), um: z.string(), cantidad: z.number(), pu: z.number() })) })),
  costoDirecto: num,
  gastosGenerales: num,
  utilidad: num,
  iva: num,
});

const SYSTEM_PRESUPUESTO = [
  "Eres un asistente que transcribe presupuestos de obras de reparación (Chile) a una tabla estructurada, sin cambiar nada.",
  "Reglas: conserva el ORDEN, los textos y los valores del documento tal como están; no corrijas, no sumes, no inventes partidas. Un número ilegible se omite en vez de adivinarlo.",
  "Los precios son pesos chilenos: «5.500» es 5500 y «9,52» es 9.52.",
].join(" ");

const INSTRUCCION_PRESUPUESTO = [
  "Transcribe el presupuesto: «secciones» en el orden del documento (cada recinto o capítulo), con sus «partidas» (descripción, unidad de medida, cantidad y precio unitario).",
  "Si una partida no tiene precio unitario pero sí total, usa total/cantidad. Los totales del pie (costo directo/neto, gastos generales, utilidad, IVA) van en sus campos, en pesos; si no constan, null.",
  "Si el presupuesto no está dividido en recintos, usa una sola sección llamada GENERAL.",
].join(NL);

export async function presupuestoConIa(cliente: ClienteLlm, fuentes: Fuente[]): Promise<ResultadoPresupuesto> {
  const est = await extraerEstructurado(cliente, { system: SYSTEM_PRESUPUESTO, instruccion: INSTRUCCION_PRESUPUESTO, fuentes, schema: presupuestoIaSchema });
  const res = presupuestoDeEstructura(est);
  res.alertas.unshift("El presupuesto se transcribió con IA a partir de una imagen o un formato sin tabla: revisa las partidas contra el original antes de ajustar.");
  return res;
}
