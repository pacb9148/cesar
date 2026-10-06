import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { consulta, uno } from "../db";
import { docxAPdf } from "../docs/pdf";
import { aplicarCeldas, cargarLibro, libroAVista, type CambioCelda, type HojaVista } from "../docs/vista-xlsx";
import { aplicarTextos, docxAVista, type BloqueVista } from "../docs/vista-docx";
import { emitir } from "../traza";

export type VistaDocumento = { tipo: "docx"; nombre: string; bloques: BloqueVista[] } | { tipo: "xlsx"; nombre: string; hojas: HojaVista[] };

type Salida = { id: string; nombre: string; mime: string; contenido: Buffer };

const esDocx = (n: string) => /\.docx$/i.test(n);
const esXlsx = (n: string) => /\.xlsx$/i.test(n);

async function salida(casoId: string, aid: string): Promise<Salida | null> {
  return uno<Salida>("select id, nombre, mime, contenido from archivos where id = $1 and caso_id = $2 and tipo = 'salida'", [aid, casoId]);
}

export async function vistaDe(casoId: string, aid: string): Promise<VistaDocumento | null> {
  const a = await salida(casoId, aid);
  if (!a) return null;
  if (esDocx(a.nombre)) return { tipo: "docx", nombre: a.nombre, bloques: docxAVista(a.contenido).bloques };
  if (esXlsx(a.nombre)) return { tipo: "xlsx", nombre: a.nombre, hojas: libroAVista(await cargarLibro(a.contenido)) };
  return null;
}

async function reemplazar(id: string, buf: Buffer) {
  await consulta("update archivos set contenido = $2, tamano = $3, sha256 = $4 where id = $1", [id, buf, buf.length, createHash("sha256").update(buf).digest("hex")]);
}

/** El paquete ZIP y el PDF se derivan de los demás entregables: tras editar uno se rehacen para que todo quede consistente. */
async function rehacerDerivados(casoId: string, editado: Salida, nuevo: Buffer, pie: string): Promise<string[]> {
  const avisos: string[] = [];
  const todas = await consulta<Salida>("select id, nombre, mime, contenido from archivos where caso_id = $1 and tipo = 'salida'", [casoId]);
  if (/INFORME\.docx$/i.test(editado.nombre)) {
    const pdf = todas.find((a) => a.nombre === editado.nombre.replace(/\.docx$/i, ".pdf"));
    if (pdf) {
      try {
        const r = await docxAPdf(nuevo, pie);
        await reemplazar(pdf.id, r.pdf);
        pdf.contenido = r.pdf;
        emitir("ok", "edicion", `PDF regenerado con ${r.motor}`);
      } catch (e) {
        avisos.push(`El PDF no se pudo regenerar (${e instanceof Error ? e.message : "error"}): conserva la versión anterior, sin tus cambios.`);
      }
    }
  }
  const zip = todas.find((a) => /Paquete completo\.zip$/i.test(a.nombre));
  if (zip) {
    const z = new PizZip();
    for (const a of todas) if (a.id !== zip.id) z.file(a.nombre, a.id === editado.id ? nuevo : a.contenido);
    await reemplazar(zip.id, z.generate({ type: "nodebuffer", compression: "DEFLATE" }));
  }
  return avisos;
}

export type ResultadoEdicion = { avisos: string[]; aplicados: number; vista: VistaDocumento };

export async function guardarEdicion(casoId: string, aid: string, cambios: { textos?: Record<string, string>; celdas?: CambioCelda[] }, pie: string): Promise<ResultadoEdicion> {
  const a = await salida(casoId, aid);
  if (!a) throw new Error("Documento no encontrado.");
  let nuevo: Buffer;
  let aplicados = 0;
  if (esDocx(a.nombre)) {
    const r = aplicarTextos(a.contenido, cambios.textos ?? {});
    nuevo = r.buffer;
    aplicados = r.aplicados;
  } else if (esXlsx(a.nombre)) {
    const r = await aplicarCeldas(a.contenido, cambios.celdas ?? []);
    nuevo = r.buffer;
    aplicados = (cambios.celdas ?? []).length;
  } else throw new Error("Solo se pueden editar los documentos Word y Excel.");
  await reemplazar(a.id, nuevo);
  const avisos = await rehacerDerivados(casoId, a, nuevo, pie);
  await consulta("update casos set actualizado = now() where id = $1", [casoId]);
  const vista = (await vistaDe(casoId, aid))!;
  return { avisos, aplicados, vista };
}
