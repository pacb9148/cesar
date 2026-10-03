import PizZip from "pizzip";
import sharp from "sharp";
import { extractImages, getDocumentProxy } from "unpdf";
import { cuadroPng, resumenCuadro } from "../docs/cuadro";
import { generarExcel, type EntradaExcel } from "../docs/excel";
import { generarAnexo } from "../docs/anexo";
import { docxAPdf } from "../docs/pdf";
import { generarInforme, type FotoInforme, type Meteo } from "../docs/word";
import { GG_UTILIDADES_UNIFICADO, IVA } from "../domain/constantes";
import { datosCasoSchema, type DatosCaso, type Reclamacion, type SalidaAgente } from "../domain/tipos";
import type { ActaInspeccion } from "../extraccion/acta";
import { esEscaneado, textoPdf } from "../extraccion/pdf";
import { ajustarCaso, type FotoModelo, type ResultadoAgente } from "../ia/agente";
import { ClienteGemini, type ClienteLlm } from "../ia/gemini";
import { credencialDe } from "../ia/credenciales";
import { evidenciaMeteorologica } from "../meteo/inia";
import { consulta } from "../db";
import {
  actualizarCaso,
  archivosConContenido,
  guardarAjuste,
  guardarArchivo,
  guardarExtraccion,
  leerExtraccion,
  leerReclamacion,
  obtenerCaso,
  registrarLlm,
  ultimoAjuste,
} from "./repositorio";

const MAX_FOTOS_MODELO = 30;
const MAX_FOTOS_POR_RECINTO_INFORME = 8;

const reclamacionVacia = (): Reclamacion => ({ secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: GG_UTILIDADES_UNIFICADO, utilidadPct: 0, ivaPct: IVA });

async function cargar(casoId: string, usuarioId: string) {
  const caso = await obtenerCaso(casoId, usuarioId);
  if (!caso) throw new Error("Caso no encontrado");
  const acta = await leerExtraccion<ActaInspeccion>(casoId, "acta");
  if (!acta) throw new Error("Primero procesa los documentos del caso (falta el acta).");
  const datos = datosCasoSchema.parse(caso.datos);
  if (!caso.valor_uf) throw new Error("Falta el valor de la UF de la fecha del siniestro (pestaña «Datos»).");
  const recl = (await leerReclamacion(casoId))?.datos ?? null;
  return { caso, acta, datos, valorUF: Number(caso.valor_uf), recl };
}

const idFoto = (uuid: string) => `ph_${uuid.slice(0, 8)}`;

async function fotosParaModelo(casoId: string): Promise<FotoModelo[]> {
  const todas = await archivosConContenido(casoId, "foto");
  const porRecinto = new Map<string, typeof todas>();
  for (const f of todas) porRecinto.set(f.recinto ?? "General", [...(porRecinto.get(f.recinto ?? "General") ?? []), f]);
  const cupo = Math.max(1, Math.floor(MAX_FOTOS_MODELO / Math.max(1, porRecinto.size)));
  const out: FotoModelo[] = [];
  for (const [recinto, fs] of porRecinto) {
    for (const f of fs.slice(0, cupo)) {
      const jpg = await sharp(f.contenido).rotate().resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
      out.push({ id: idFoto(f.id), recinto, mime: "image/jpeg", base64: jpg.toString("base64") });
    }
  }
  return out;
}

export async function ejecutarAjuste(casoId: string, usuarioId: string, cliente?: ClienteLlm): Promise<ResultadoAgente & { version: number }> {
  const { acta, datos, valorUF, recl } = await cargar(casoId, usuarioId);
  const modo = datos.modo;
  if (modo === "reclamacion" && !recl) throw new Error("No hay reclamación leída: sube el presupuesto del contratista.");
  // BYOK: se usa la clave y el modelo del propio usuario; la variable de entorno queda solo como respaldo del administrador.
  const cred = cliente ? null : await credencialDe(usuarioId);
  const cli = cliente ?? (cred ? new ClienteGemini(cred.clave, cred.modelo) : process.env.GEMINI_API_KEY ? new ClienteGemini() : null);
  if (!cli) throw new Error("Falta tu clave de Gemini: ingrésala en «Ajustes de IA» (menú superior).");
  const fotos = await fotosParaModelo(casoId);
  try {
    const r = await ajustarCaso(
      { modo, fechaSiniestro: datos.fechas.ocurrencia, valorUF, acta, reclamacion: recl ?? reclamacionVacia(), fotos, preciosMercado: [] },
      cli,
    );
    const version = await guardarAjuste(casoId, r.salida, "agente", r.modelo, r.promptVersion);
    await registrarLlm({ casoId, tarea: "ajuste", modelo: r.modelo, promptVersion: r.promptVersion, tin: r.tokensEntrada, tout: r.tokensSalida, ok: r.validacion.errores.length === 0 });
    await actualizarCaso(casoId, { estado: "ajustado" });
    return { ...r, version };
  } catch (e) {
    await registrarLlm({ casoId, tarea: "ajuste", modelo: cred?.modelo ?? process.env.GEMINI_MODEL ?? "?", promptVersion: "v0.1", ok: false, error: String(e).slice(0, 500) });
    throw e;
  }
}

/** Fotos de fachada y número del inmueble que vienen incrustadas en el acta (páginas finales). */
async function fachadaDelActa(casoId: string): Promise<Buffer[]> {
  const actas = await archivosConContenido(casoId, "acta");
  if (!actas[0]) return [];
  try {
    const pag = await textoPdf(actas[0].contenido);
    if (esEscaneado(pag)) return [];
    const pdf = await getDocumentProxy(new Uint8Array(actas[0].contenido));
    // El logo de Beckett se repite en todas las páginas con el mismo tamaño: se descarta por frecuencia.
    const porPagina: { w: number; h: number; data: Uint8ClampedArray; canales: 1 | 2 | 3 | 4 }[][] = [];
    const frecuencia = new Map<string, number>();
    for (let i = 0; i < pag.length; i++) {
      const imgs = (await extractImages(pdf, i + 1)).map((im) => ({ w: im.width, h: im.height, data: im.data, canales: im.channels as 1 | 2 | 3 | 4 }));
      porPagina.push(imgs);
      for (const k of new Set(imgs.map((x) => `${x.w}x${x.h}`))) frecuencia.set(k, (frecuencia.get(k) ?? 0) + 1);
    }
    const out: Buffer[] = [];
    for (let i = 0; i < pag.length; i++) {
      // Solo las páginas de fachada/número; nunca las de la cédula del firmante.
      if (!/Fachada|N° de Inmueble/i.test(pag[i]) || /Carnet/i.test(pag[i])) continue;
      const fotos = porPagina[i].filter((x) => (frecuencia.get(`${x.w}x${x.h}`) ?? 0) < 2).sort((a, b) => b.w * b.h - a.w * a.h);
      for (const im of fotos) out.push(await sharp(Buffer.from(im.data), { raw: { width: im.w, height: im.h, channels: im.canales } }).jpeg({ quality: 85 }).toBuffer());
    }
    return out.slice(0, 2);
  } catch {
    return [];
  }
}

async function meteo(casoId: string, datos: DatosCaso): Promise<Meteo | null> {
  const previo = await leerExtraccion<{ estacion: string; precipitacionMm: number | null; rafagaKmh: number | null; fecha: string }>(casoId, "meteo");
  const imgs = await archivosConContenido(casoId, "meteo_png");
  if (previo && previo.fecha === datos.fechas.ocurrencia && imgs[0]) {
    return { estacion: previo.estacion, precipitacionMm: previo.precipitacionMm, rafagaKmh: previo.rafagaKmh, imagenPng: imgs[0].contenido };
  }
  try {
    const r = await evidenciaMeteorologica(`${datos.ubicacion}, Chile`, datos.fechas.ocurrencia);
    if (!r) return null;
    const estacion = `${r.estacion.nombre}, ${r.estacion.comuna}`;
    await guardarExtraccion(casoId, "meteo", { estacion, precipitacionMm: r.dia.precipitacionMm, rafagaKmh: r.dia.rafagaKmh, vientoKmh: r.dia.vientoKmh, fecha: datos.fechas.ocurrencia, distanciaKm: r.distanciaKm });
    await consulta("delete from archivos where caso_id = $1 and tipo = 'meteo_png'", [casoId]);
    await guardarArchivo({ casoId, nombre: "meteorologia.png", tipo: "meteo_png", mime: "image/png", contenido: r.imagenPng });
    return { estacion, precipitacionMm: r.dia.precipitacionMm, rafagaKmh: r.dia.rafagaKmh, imagenPng: r.imagenPng };
  } catch (e) {
    console.error("[meteo]", e);
    return null;
  }
}

export type Entregable = { id: string; nombre: string; mime: string; tamano: number };

export type ResultadoGeneracion = {
  entregables: Entregable[];
  motorPdf: string;
  totales: { reclamacionUF: number; ajusteUF: number; indemnizacionUF: number };
  faltantes: string[];
};

export function entradaExcelDe(datos: DatosCaso, acta: ActaInspeccion, recl: Reclamacion | null, salida: SalidaAgente, valorUF: number): EntradaExcel {
  return {
    caso: datos,
    reclamacion: recl ?? reclamacionVacia(),
    decisiones: salida.lineas,
    adicionales: salida.lineas_adicionales,
    valorUF,
    recintos: acta.danos.map((d) => ({ nombre: d.recinto, alto: d.alto, largo: d.largo, ancho: d.ancho })),
    siniestrosAnteriores: [],
  };
}

export async function generarSalidas(casoId: string, usuarioId: string): Promise<ResultadoGeneracion> {
  const { caso, acta, datos, valorUF, recl } = await cargar(casoId, usuarioId);
  const aj = await ultimoAjuste(casoId);
  if (!aj) throw new Error("Aún no hay un ajuste: ejecútalo primero.");
  const salida = aj.salida;
  const entrada = entradaExcelDe(datos, acta, recl, salida, valorUF);
  const res = resumenCuadro(entrada);

  const [xlsx, cuadro, met, fachada, fotosDb] = await Promise.all([
    generarExcel(entrada),
    cuadroPng(entrada),
    meteo(casoId, datos),
    fachadaDelActa(casoId),
    archivosConContenido(casoId, "foto"),
  ]);

  const todas: FotoInforme[] = fotosDb.map((f) => ({ recinto: f.recinto ?? "General", buffer: f.contenido }));
  const paraInforme: FotoInforme[] = [];
  const contador = new Map<string, number>();
  for (const f of todas) {
    const n = contador.get(f.recinto) ?? 0;
    if (n < MAX_FOTOS_POR_RECINTO_INFORME) paraInforme.push(f);
    contador.set(f.recinto, n + 1);
  }

  const docx = await generarInforme({
    caso: datos,
    valorUF,
    caracteristicas: salida.caracteristicas,
    evidencia: salida.evidencia_observada,
    ajusteTexto: salida.ajuste_de_perdida_texto,
    totales: { reclamacionPesos: res.recTotalPesos, reclamacionUF: res.recUF, ajusteUF: res.ajUF, indemnizacionUF: res.indemnizacionUF },
    meteo: met,
    cuadroPng: cuadro,
    fotos: paraInforme,
    fachada,
    siniestrosAnteriores: false,
  });
  const pie = `Liquidación ${datos.liquidacion}/${datos.fechas.ocurrencia.slice(0, 4)}`;
  const [{ pdf, motor }, anexo] = await Promise.all([
    docxAPdf(docx, pie),
    generarAnexo({ siniestro: datos.siniestro, asegurado: datos.asegurado.nombre, liquidacion: datos.liquidacion, anio: datos.fechas.ocurrencia.slice(0, 4), fotos: todas }),
  ]);

  const resumen = [`RESUMEN DEL AJUSTE TÉCNICO APLICADO — Siniestro ${datos.siniestro}`, "", ...salida.resumen_ajuste.map((x) => `• ${x}`), "", ...(salida.faltantes.length ? ["PENDIENTES:", ...salida.faltantes.map((f) => `• ${f.campo}: ${f.motivo}`)] : [])].join("\n");

  const s = datos.siniestro;
  const piezas: [string, string, Buffer][] = [
    [`${s} Ajuste.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx],
    [`${s} INFORME.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx],
    [`${s} INFORME.pdf`, "application/pdf", pdf],
    [`Anexo Fotografías ${s}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", anexo],
    [`${s} Resumen del ajuste.txt`, "text/plain; charset=utf-8", Buffer.from(resumen, "utf8")],
  ];
  const zip = new PizZip();
  for (const [n, , b] of piezas) zip.file(n, b);
  piezas.push([`${s} Paquete completo.zip`, "application/zip", zip.generate({ type: "nodebuffer", compression: "DEFLATE" })]);

  await consulta("delete from archivos where caso_id = $1 and tipo = 'salida'", [casoId]);
  const entregables: Entregable[] = [];
  for (const [nombre, mime, buf] of piezas) {
    const id = await guardarArchivo({ casoId, nombre, tipo: "salida", mime, contenido: buf });
    entregables.push({ id, nombre, mime, tamano: buf.length });
  }
  await actualizarCaso(casoId, { estado: "emitido" });

  const faltantes: string[] = [...salida.faltantes.map((f) => f.campo)];
  if (!met) faltantes.push("captura de agrometeorologia.cl");
  if (!datos.denunciaTexto) faltantes.push("texto de la denuncia");
  if (!datos.fechas.emision) faltantes.push("fecha de emisión del informe");
  if (!datos.fechas.informadoPartes) faltantes.push("fecha en que se informó a las partes");
  void caso;
  return { entregables, motorPdf: motor, totales: { reclamacionUF: res.recUF, ajusteUF: res.ajUF, indemnizacionUF: res.indemnizacionUF }, faltantes };
}
