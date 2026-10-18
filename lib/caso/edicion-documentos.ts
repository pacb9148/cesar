import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { consulta, uno } from "../db";
import { cuadroTablaXml, n0, nf2, resumenCuadro } from "../docs/cuadro";
import { generarAnexo } from "../docs/anexo";
import { CALIDAD_POR_DEFECTO } from "../fotos/calidad";
import { docxAPdf, motorPdfDisponible } from "../docs/pdf";
import { seleccionarFotosInforme } from "../docs/fotos-seleccion";
import { actualizarTotales, reemplazarCuadro, reemplazarFotos, reemplazarTextosDatos, type FotoParaWord } from "../docs/sincronizar-word";
import { aplicarEdiciones, docxAVista, type BloqueVista, type EdicionesWord } from "../docs/vista-docx";
import { aplicarCeldas, cargarLibro, libroAVista, type CambioCelda, type CambioFormato, type HojaVista } from "../docs/vista-xlsx";
import type { EntradaExcel } from "../docs/excel";
import { datosCasoSchema } from "../domain/tipos";
import { leerPlanilla } from "../extraccion/planilla";
import type { ActaInspeccion } from "../extraccion/acta";
import { leerLeyendasGrupos } from "./generacion";
import { fotosPerezosas, guardarExtraccion, leerExtraccion, obtenerCaso, ultimoAjuste } from "./repositorio";
import { salidaBase } from "./ajuste-base";
import { textosDelInforme } from "./textos-informe";

export type VistaDocumento =
  | { tipo: "docx"; nombre: string; bloques: BloqueVista[] }
  | { tipo: "xlsx"; nombre: string; hojas: HojaVista[] }
  | { tipo: "texto"; nombre: string; contenido: string }
  | { tipo: "zip"; nombre: string; entradas: { nombre: string; tamano: number }[] };

type Salida = { id: string; nombre: string; mime: string; contenido: Buffer };

const esDocx = (n: string) => /\.docx$/i.test(n);
const esXlsx = (n: string) => /\.xlsx$/i.test(n);
const esTexto = (n: string) => /\.txt$/i.test(n);
const esZip = (n: string) => /\.zip$/i.test(n);
const esInforme = (n: string) => /INFORME\.docx$/i.test(n);

const salidas = (casoId: string) => consulta<Salida>("select id, nombre, mime, contenido from archivos where caso_id = $1 and tipo = 'salida'", [casoId]);

async function salida(casoId: string, aid: string): Promise<Salida | null> {
  return uno<Salida>("select id, nombre, mime, contenido from archivos where id = $1 and caso_id = $2 and tipo = 'salida'", [aid, casoId]);
}

export async function vistaDe(casoId: string, aid: string): Promise<VistaDocumento | null> {
  const a = await salida(casoId, aid);
  if (!a) return null;
  if (esDocx(a.nombre)) return { tipo: "docx", nombre: a.nombre, bloques: docxAVista(a.contenido).bloques };
  if (esXlsx(a.nombre)) return { tipo: "xlsx", nombre: a.nombre, hojas: libroAVista(await cargarLibro(a.contenido)) };
  if (esTexto(a.nombre)) return { tipo: "texto", nombre: a.nombre, contenido: a.contenido.toString("utf8") };
  if (esZip(a.nombre)) {
    const z = new PizZip(a.contenido);
    return { tipo: "zip", nombre: a.nombre, entradas: Object.values(z.files).filter((f) => !f.dir).map((f) => ({ nombre: f.name, tamano: f.asNodeBuffer().length })) };
  }
  return null;
}

/** El mismo documento convertido a PDF con LibreOffice, tal como quedará impreso (no se guarda). */
export async function pdfDe(casoId: string, aid: string): Promise<Buffer | null> {
  const a = await salida(casoId, aid);
  if (!a || !esDocx(a.nombre)) return null;
  if (!(await motorPdfDisponible())) throw new Error("Este servidor no tiene LibreOffice: no se puede mostrar la vista exacta del PDF.");
  return (await docxAPdf(a.contenido, "")).pdf;
}

async function reemplazar(id: string, buf: Buffer) {
  await consulta("update archivos set contenido = $2, tamano = $3, sha256 = $4 where id = $1", [id, buf, buf.length, createHash("sha256").update(buf).digest("hex")]);
}

const pieDe = (datos: { liquidacion?: string; fechas?: { ocurrencia?: string } }) => `Liquidación ${datos.liquidacion ?? ""}/${(datos.fechas?.ocurrencia ?? "").slice(0, 4)}`;

/** El PDF y el ZIP se derivan de los demás entregables: tras cambiar uno se rehacen para que todo quede consistente. */
async function rehacerDerivados(casoId: string, pie: string): Promise<string[]> {
  const avisos: string[] = [];
  const todas = await salidas(casoId);
  const informe = todas.find((a) => esInforme(a.nombre));
  const pdf = informe && todas.find((a) => a.nombre === informe.nombre.replace(/\.docx$/i, ".pdf"));
  if (informe && pdf) {
    try {
      const r = await docxAPdf(informe.contenido, pie);
      await reemplazar(pdf.id, r.pdf);
      pdf.contenido = r.pdf;
    } catch (e) {
      avisos.push(`El PDF no se pudo regenerar (${e instanceof Error ? e.message : "error"}): conserva la versión anterior, sin los cambios.`);
    }
  }
  const zip = todas.find((a) => /Paquete completo\.zip$/i.test(a.nombre));
  if (zip) {
    const z = new PizZip();
    for (const a of todas) if (a.id !== zip.id) z.file(a.nombre, a.contenido);
    await reemplazar(zip.id, z.generate({ type: "nodebuffer", compression: "DEFLATE" }));
  }
  return avisos;
}

async function entradaDeExcel(casoId: string, usuarioId: string, xlsx: Buffer): Promise<{ entrada: EntradaExcel; resumen: ReturnType<typeof resumenCuadro> }> {
  const caso = await obtenerCaso(casoId, usuarioId);
  if (!caso) throw new Error("Caso no encontrado");
  const p = await leerPlanilla(xlsx);
  const entrada: EntradaExcel = {
    caso: datosCasoSchema.parse(caso.datos),
    reclamacion: p.reclamacion,
    decisiones: p.decisiones,
    adicionales: p.adicionales,
    valorUF: p.valorUF ?? Number(caso.valor_uf ?? 0),
    recintos: [],
    siniestrosAnteriores: [],
  };
  return { entrada, resumen: resumenCuadro(entrada) };
}

/** Al editar el Excel: el cuadro de pérdida del informe se rehace con los valores nuevos y los totales del texto se actualizan solos. */
async function sincronizarWordConExcel(casoId: string, usuarioId: string, antes: Buffer, despues: Buffer): Promise<string[]> {
  const informe = (await salidas(casoId)).find((a) => esInforme(a.nombre));
  if (!informe) return [];
  const viejo = await entradaDeExcel(casoId, usuarioId, antes);
  const nuevo = await entradaDeExcel(casoId, usuarioId, despues);
  const a = viejo.resumen;
  const b = nuevo.resumen;
  const uf = (x: number) => nf2(x);
  const t = actualizarTotales(informe.contenido, [
    [`$${n0(a.recTotalPesos)}`, `$${n0(b.recTotalPesos)}`],
    [uf(a.recUF), uf(b.recUF)],
    [uf(a.ajUF), uf(b.ajUF)],
    [uf(a.indemnizacionUF), uf(b.indemnizacionUF)],
  ]);
  const c = reemplazarCuadro(t.buffer, cuadroTablaXml(nuevo.entrada)[0]);
  await reemplazar(informe.id, c.buffer);
  return c.encontrado ? [] : ["El informe no trae el cuadro de pérdida como tabla (se generó con una versión anterior): vuelve a generarlo para que se actualice solo."];
}

async function fotosParaWord(casoId: string): Promise<{ todas: (FotoParaWord & { edicion: FotoParaWord["edicion"] })[]; acta: ActaInspeccion | null }> {
  const acta = await leerExtraccion<ActaInspeccion>(casoId, "acta");
  const todas = (await fotosPerezosas(casoId)).map((f) => ({ ...f, leyenda: "" }));
  return { todas, acta };
}

/**
 * Después de editar el recorte de una foto (o elegir cuáles van): el informe rehace su sección de fotografías con lo que el
 * usuario dejó, y el anexo se regenera. El PDF y el ZIP se rehacen. No hace nada si el caso todavía no tiene documentos.
 */
export async function sincronizarFotos(casoId: string, usuarioId: string): Promise<string[]> {
  const todas = await salidas(casoId);
  const informe = todas.find((a) => esInforme(a.nombre));
  if (!informe) return [];
  const caso = await obtenerCaso(casoId, usuarioId);
  if (!caso) return [];
  const { todas: fotos, acta } = await fotosParaWord(casoId);
  const avisos: string[] = [];
  const calidad = caso.datos.entrega?.calidad ?? CALIDAD_POR_DEFECTO;
  const elegidas = acta ? seleccionarFotosInforme(fotos, acta).fotos : fotos;
  if (acta) {
    const pies = await leerLeyendasGrupos(casoId);
    const r = await reemplazarFotos(informe.contenido, elegidas, pies, { calidad, alOmitirFoto: (f) => avisos.push(`Foto omitida por estar dañada: ${f.id}`) });
    if (r.encontrado) await reemplazar(informe.id, r.buffer);
    else avisos.push("No se encontró la sección de fotografías del informe: vuelve a generarlo.");
  }
  const anexo = todas.find((a) => /^Anexo/i.test(a.nombre) && esDocx(a.nombre));
  if (anexo) {
    const d = caso.datos;
    await reemplazar(anexo.id, await generarAnexo({ siniestro: d.siniestro ?? "", asegurado: d.asegurado?.nombre ?? "", liquidacion: d.liquidacion ?? "", anio: (d.fechas?.ocurrencia ?? "").slice(0, 4), fotos: elegidas, fachada: (await (await import("./generar")).fachadaDelActa(casoId))[0], pies: await leerLeyendasGrupos(casoId), calidad, compacto: caso.datos.entrega?.anexoCompacto, alOmitirFoto: (f) => avisos.push(`Foto omitida del anexo por estar dañada: ${f.id}`) }));
  }
  return [...avisos, ...(await rehacerDerivados(casoId, pieDe(caso.datos)))];
}

export type ResultadoEdicion = { avisos: string[]; aplicados: number; vista: VistaDocumento };

export async function guardarEdicion(casoId: string, usuarioId: string, aid: string, cambios: { word?: EdicionesWord; celdas?: CambioCelda[]; formato?: CambioFormato; texto?: string }): Promise<ResultadoEdicion> {
  const a = await salida(casoId, aid);
  if (!a) throw new Error("Documento no encontrado.");
  const caso = await obtenerCaso(casoId, usuarioId);
  if (!caso) throw new Error("Caso no encontrado");
  let nuevo: Buffer;
  let aplicados = 0;
  const avisos: string[] = [];
  if (esDocx(a.nombre)) {
    const r = aplicarEdiciones(a.contenido, cambios.word ?? {});
    nuevo = r.buffer;
    aplicados = r.aplicados;
    await reemplazar(a.id, nuevo);
  } else if (esXlsx(a.nombre)) {
    const r = await aplicarCeldas(a.contenido, cambios.celdas ?? [], cambios.formato ?? {});
    nuevo = r.buffer;
    aplicados = (cambios.celdas ?? []).length + (cambios.formato?.columnas?.length ?? 0) + (cambios.formato?.filas?.length ?? 0);
    await reemplazar(a.id, nuevo);
    avisos.push(...(await sincronizarWordConExcel(casoId, usuarioId, a.contenido, nuevo)));
  } else if (esTexto(a.nombre)) {
    nuevo = Buffer.from(cambios.texto ?? a.contenido.toString("utf8"), "utf8");
    aplicados = 1;
    await reemplazar(a.id, nuevo);
  } else throw new Error("Solo se pueden editar los documentos Word, Excel y de texto.");
  avisos.push(...(await rehacerDerivados(casoId, pieDe(caso.datos))));
  await consulta("update casos set actualizado = now() where id = $1", [casoId]);
  const vista = (await vistaDe(casoId, aid))!;
  return { avisos, aplicados, vista };
}

/**
 * Cambio en las fotos o en las leyendas de grupo: se aplica y el informe y el anexo se rehacen con la nueva disposición. El informe NO queda
 * «al día»: cualquier cambio activa «Volver a generar el informe», que es el paso que entrega la última versión completa de todo.
 */
export async function aplicarCambioFotos(casoId: string, usuarioId: string, cambio: () => Promise<unknown>, opciones: { diferir?: boolean } = {}): Promise<string[]> {
  await cambio();
  // Con `diferir` el cambio solo se guarda: los documentos se rehacen después, de una vez, con todos los cambios (regeneración en cascada).
  if (opciones.diferir) return [];
  return sincronizarFotos(casoId, usuarioId).catch((e: unknown) => [`No se pudo actualizar los documentos: ${e instanceof Error ? e.message : "error"}`]);
}

/** Leyenda al pie del grupo de fotos de una estancia (vacía = sin leyenda). */
export async function guardarLeyendaGrupo(casoId: string, recinto: string, leyenda: string): Promise<void> {
  const actual = await leerLeyendasGrupos(casoId);
  const limpia = leyenda.replace(/\s+/g, " ").trim();
  if (limpia) actual[recinto] = limpia;
  else delete actual[recinto];
  await guardarExtraccion(casoId, "leyendas_grupos", actual);
}

/** Inserta en el informe ya generado los textos de «Datos» (características y evidencia observada) y rehace el PDF y el ZIP. `insertado` es false si aún no hay informe. */
export async function sincronizarTextos(casoId: string, usuarioId: string): Promise<{ insertado: boolean; avisos: string[] }> {
  const informe = (await salidas(casoId)).find((a) => esInforme(a.nombre));
  if (!informe) return { insertado: false, avisos: [] };
  const caso = await obtenerCaso(casoId, usuarioId);
  const acta = await leerExtraccion<ActaInspeccion>(casoId, "acta");
  if (!caso || !acta) return { insertado: false, avisos: [] };
  const aj = await ultimoAjuste(casoId);
  const t = textosDelInforme(caso.datos, acta, aj?.salida ?? salidaBase(acta));
  const r = reemplazarTextosDatos(informe.contenido, { caracteristicas: t.caracteristicas, evidencia: t.evidencia });
  const avisos: string[] = [];
  if (!r.caracteristicas && t.caracteristicas) avisos.push("No se encontró el párrafo de características en el informe: vuelve a generarlo para que lo incluya.");
  if (!r.evidencia) avisos.push("No se encontró la lista de evidencia observada en el informe: vuelve a generarlo para que la incluya.");
  if (r.caracteristicas || r.evidencia) await reemplazar(informe.id, r.buffer);
  avisos.push(...(await rehacerDerivados(casoId, pieDe(caso.datos))));
  await consulta("update casos set actualizado = now() where id = $1", [casoId]);
  return { insertado: r.caracteristicas || r.evidencia, avisos };
}
