import PizZip from "pizzip";
import sharp from "sharp";
import { extractImages, getDocumentProxy } from "unpdf";
import { cuadroTablaXml, resumenCuadro } from "../docs/cuadro";
import { generarExcel, type EntradaExcel } from "../docs/excel";
import { generarAnexo } from "../docs/anexo";
import { seleccionarFotosInforme } from "../docs/fotos-seleccion";
import { docxAPdf } from "../docs/pdf";
import { generarInforme, type FotoInforme, type Meteo } from "../docs/word";
import { GG_UTILIDADES_UNIFICADO, IVA } from "../domain/constantes";
import { datosCasoSchema, type DatosCaso, type Reclamacion, type SalidaAgente } from "../domain/tipos";
import type { ActaInspeccion } from "../extraccion/acta";
import { esEscaneado, textoPdf } from "../extraccion/pdf";
import { cargarPrevias, guardarResultado, limpiarAnalisis } from "./analisis-partidas";
import { PROMPT_VERSION } from "../ia/prompt";
import { ajustarCaso, tamanosDelAjuste, type EntradaAgente, type FotoModelo, type ResultadoAgente } from "../ia/agente";
import { destinoDe, listarProveedores } from "../ia/repo-proveedores";
import { emitir } from "../traza";
import type { ClienteLlm } from "../ia/gemini";
import { RegistroDb } from "../ia/repo-proveedores";
import { ClienteConRespaldo } from "../ia/rotacion";
import { evidenciaMeteorologica } from "../meteo/inia";
import { consulta } from "../db";
import { leerLeyendasGrupos, marcarAlDia } from "./generacion";
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

/** Identifica a qué reclamación y a qué instrucciones pertenecen los resultados temporales de la lectura por partidas. */
async function huellaDe(casoId: string): Promise<string> {
  return `${(await leerReclamacion(casoId))?.hash ?? "sin-reclamacion"}:${PROMPT_VERSION}`;
}

async function prepararAjuste(casoId: string, usuarioId: string): Promise<EntradaAgente> {
  const { acta, datos, valorUF, recl } = await cargar(casoId, usuarioId);
  const modo = datos.modo;
  if (modo === "reclamacion" && !recl) throw new Error("No hay reclamación leída: sube el presupuesto del contratista.");
  emitir("info", "datos", `Caso leído: modo «${modo}», ${recl?.lineas.length ?? 0} partidas del contratista, ${acta.danos.length} recintos dañados en el acta, UF ${valorUF}`);
  const fotos = await fotosParaModelo(casoId);
  const kbFotos = Math.round(fotos.reduce((t, f) => t + f.base64.length, 0) / 1024);
  emitir("ok", "fotos", `${fotos.length} fotografías preparadas para el modelo (reducidas a 768 px, ${kbFotos} KB en total)`);
  return { modo, fechaSiniestro: datos.fechas.ocurrencia, valorUF, acta, reclamacion: recl ?? reclamacionVacia(), fotos, preciosMercado: [] };
}

/** Qué se le enviará a la IA, sin llamarla: lotes, tamaños, cantidad de fotos y proveedores que se usarán, para revisarlo antes de ejecutar. */
export async function vistaPreviaAjuste(casoId: string, usuarioId: string) {
  const entrada = await prepararAjuste(casoId, usuarioId);
  const t = tamanosDelAjuste(entrada);
  const reanudables = (await cargarPrevias(casoId, await huellaDe(casoId))).size;
  const bytesFotos = entrada.fotos.reduce((tt, f) => tt + f.base64.length, 0);
  const porRecinto: Record<string, number> = {};
  for (const f of entrada.fotos) porRecinto[f.recinto] = (porRecinto[f.recinto] ?? 0) + 1;
  const proveedores = (await listarProveedores(usuarioId)).map((p) => ({
    nombre: p.nombre,
    modelo: p.modelo,
    destino: destinoDe(p.tipo, p.baseUrl),
    activo: p.activo,
    estado: p.estado,
    enPausa: !!p.enPausaHasta && new Date(p.enPausaHasta) > new Date(),
    prioridad: p.prioridad,
  }));
  const tokens = (c: number) => Math.round(c / 3.5);
  return {
    modo: entrada.modo,
    valorUF: entrada.valorUF,
    partidasReclamacion: entrada.reclamacion.lineas.length,
    recintosActa: entrada.acta.danos.length,
    fotos: { cantidad: entrada.fotos.length, kb: Math.round(bytesFotos / 1024), porRecinto },
    pasos: [
      ...(t.partidas > 0
        ? [{ nombre: `Leer cada partida por separado (${t.partidas} peticiones chicas, ${t.paralelo} a la vez${reanudables > 0 ? `; ${reanudables} ya analizadas se retoman sin repetir` : ""})`, kb: Math.round((t.caracteresPorPartida.medio + t.instruccionesClasificar) / 1024), tokens: tokens(t.caracteresPorPartida.medio + t.instruccionesClasificar), fotos: 0 }]
        : []),
      { nombre: "Redactar descripción, evidencia y resumen (con las fotos)", kb: Math.round((t.datosRedactar + t.instruccionesRedactar + bytesFotos) / 1024), tokens: tokens(t.datosRedactar + t.instruccionesRedactar) + entrada.fotos.length * 400, fotos: entrada.fotos.length },
    ],
    proveedores,
    muestraDatos: t.muestraPartida,
  };
}

export async function ejecutarAjuste(casoId: string, usuarioId: string, cliente?: ClienteLlm): Promise<ResultadoAgente & { version: number }> {
  emitir("info", "datos", "Leyendo el caso y preparando lo que se enviará a la IA");
  const entrada = await prepararAjuste(casoId, usuarioId);
  // BYOK abierto: proveedores del propio usuario en orden de prioridad, con salto automático al siguiente si uno no responde.
  const cli = cliente ?? new ClienteConRespaldo(new RegistroDb(usuarioId), 3);
  try {
    const huella = await huellaDe(casoId);
    const r = await ajustarCaso(entrada, cli, {
      previas: () => cargarPrevias(casoId, huella),
      guardar: (item, res) => guardarResultado(casoId, huella, item, res),
    });
    const version = await guardarAjuste(casoId, r.salida, "agente", r.modelo, r.promptVersion);
    await registrarLlm({ casoId, tarea: "ajuste", modelo: r.modelo, promptVersion: r.promptVersion, tin: r.tokensEntrada, tout: r.tokensSalida, ok: r.validacion.errores.length === 0 });
    await actualizarCaso(casoId, { estado: "ajustado" });
    await limpiarAnalisis(casoId); // el ajuste ya quedó consolidado en un solo documento: los resultados temporales sobran
    emitir("ok", "guardado", `Ajuste guardado como versión ${version} (${r.intentos} intento(s), ${r.validacion.errores.length} error(es) pendientes)`);
    return { ...r, version };
  } catch (e) {
    await registrarLlm({ casoId, tarea: "ajuste", modelo: "sin proveedor activo", promptVersion: "v0.1", ok: false, error: String(e).slice(0, 500) });
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
    emitir("error", "meteo", `No se pudo capturar agrometeorologia.cl: ${e instanceof Error ? e.message : "error"}`);
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
  emitir("info", "informe", `Ajuste v${aj.version ?? "?"} cargado: UF reclamada ${res.recUF.toFixed(2)}, ajustada ${res.ajUF.toFixed(2)}, a indemnizar ${res.indemnizacionUF.toFixed(2)}`);
  emitir("info", "informe", "Generando Excel, captura meteorológica, fachada y fotos en paralelo (la captura de agrometeorologia.cl puede tardar)");

  const [xlsx, met, fachada, fotosDb] = await Promise.all([
    generarExcel(entrada),
    meteo(casoId, datos),
    fachadaDelActa(casoId),
    archivosConContenido(casoId, "foto"),
  ]);

  const todas: FotoInforme[] = fotosDb.map((f) => ({ id: f.id, recinto: f.recinto ?? "General", buffer: f.contenido, leyenda: "", edicion: f.edicion }));
  // Si el usuario marcó fotos para el informe, van esas (con su recorte); si no, las del área afectada. El anexo lleva todas.
  const { fotos: paraInforme, elegidas } = seleccionarFotosInforme(todas, acta);
  emitir("info", "informe", `${paraInforme.length} fotos para el informe (${elegidas ? "elegidas por ti" : "automáticas del área afectada"}); ${todas.filter((f) => f.edicion).length} con recorte editado`);

  emitir("ok", "informe", `Excel, cuadro y fotos listos; meteorología: ${met ? `estación ${met.estacion}` : "no disponible"}; ${fotosDb.length} fotos del caso, ${fachada.length} de fachada`);
  emitir("info", "informe", "Armando el informe Word con la plantilla");
  const docx = await generarInforme({
    caso: datos,
    valorUF,
    caracteristicas: salida.caracteristicas,
    evidencia: salida.evidencia_observada,
    ajusteTexto: salida.ajuste_de_perdida_texto,
    totales: { reclamacionPesos: res.recTotalPesos, reclamacionUF: res.recUF, ajusteUF: res.ajUF, indemnizacionUF: res.indemnizacionUF },
    meteo: met,
    cuadroTabla: cuadroTablaXml(entrada),
    fotos: paraInforme,
    piesGrupos: await leerLeyendasGrupos(casoId),
    fachada,
    siniestrosAnteriores: false,
  });
  emitir("ok", "informe", `Informe Word generado (${Math.round(docx.length / 1024)} KB). Convirtiendo a PDF y armando el anexo de fotografías`);
  const pie = `Liquidación ${datos.liquidacion}/${datos.fechas.ocurrencia.slice(0, 4)}`;
  const [pdfMotor, anexo] = await Promise.all([
    docxAPdf(docx, pie).catch((err: unknown) => {
      emitir("error", "informe", `No se pudo generar el PDF (${err instanceof Error ? err.message : "error"}): se entrega el Word`);
      return null;
    }),
    generarAnexo({ siniestro: datos.siniestro, asegurado: datos.asegurado.nombre, liquidacion: datos.liquidacion, anio: datos.fechas.ocurrencia.slice(0, 4), fotos: todas, pies: await leerLeyendasGrupos(casoId) }),
  ]);

  const pdf = pdfMotor?.pdf ?? null;
  const motor = pdfMotor?.motor ?? "ninguno";
  if (pdf) emitir("ok", "informe", `PDF generado con ${motor}`);
  const resumen = [`RESUMEN DEL AJUSTE TÉCNICO APLICADO — Siniestro ${datos.siniestro}`, "", ...salida.resumen_ajuste.map((x) => `• ${x}`), "", ...(salida.faltantes.length ? ["PENDIENTES:", ...salida.faltantes.map((f) => `• ${f.campo}: ${f.motivo}`)] : [])].join("\n");

  const s = datos.siniestro;
  const piezas: [string, string, Buffer][] = [
    [`${s} Ajuste.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx],
    [`${s} INFORME.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx],
    ...(pdf ? ([[`${s} INFORME.pdf`, "application/pdf", pdf]] as [string, string, Buffer][]) : []),
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
  await marcarAlDia(casoId);

  const faltantes: string[] = [...salida.faltantes.map((f) => f.campo)];
  if (!met) faltantes.push("captura de agrometeorologia.cl");
  if (!pdf) faltantes.push("PDF del informe (el servidor no tiene LibreOffice ni Chromium)");
  if (!datos.denunciaTexto) faltantes.push("texto de la denuncia");
  if (!datos.fechas.emision) faltantes.push("fecha de emisión del informe");
  if (!datos.fechas.informadoPartes) faltantes.push("fecha en que se informó a las partes");
  void caso;
  return { entregables, motorPdf: motor, totales: { reclamacionUF: res.recUF, ajusteUF: res.ajUF, indemnizacionUF: res.indemnizacionUF }, faltantes };
}
