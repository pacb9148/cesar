import sharp from "sharp";
import { conUsuario, fallo, json } from "@/lib/api";
import { clasificarArchivo, type TipoArchivo } from "@/lib/caso/clasificar";
import { auditar, contenidoArchivo, eliminarArchivo, obtenerCaso, reemplazarArchivo } from "@/lib/caso/repositorio";

export const GET = conUsuario<{ id: string; aid: string }>(async (req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const a = await contenidoArchivo(aid, id);
  if (!a) return fallo("Archivo no encontrado", 404);
  const q = new URL(req.url).searchParams;
  const descargar = q.get("descargar") === "1";
  // Miniatura para las galerías: evita descargar la foto completa solo para mostrar un cuadro pequeño.
  if (q.get("miniatura") === "1" && a.mime.startsWith("image/")) {
    const mini = await sharp(a.contenido).rotate().resize({ width: 360, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    return new Response(new Uint8Array(mini), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  }
  return new Response(new Uint8Array(a.contenido), {
    headers: {
      "Content-Type": a.mime,
      "Content-Disposition": `${descargar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(a.nombre)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export const DELETE = conUsuario<{ id: string; aid: string }>(async (_req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  await eliminarArchivo(aid, id);
  return json({ ok: true });
});

const MAX_BYTES = 30 * 1024 * 1024;
const PERMITIDOS = /\.(pdf|docx?|xlsx?|jpe?g|png|webp)$/i;

/** Reemplaza el contenido de un archivo cargado por otro (por ejemplo, una versión corregida del presupuesto). Hay que volver a leer los documentos. */
export const PUT = conUsuario<{ id: string; aid: string }>(async (req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const actual = await contenidoArchivo(aid, id);
  if (!actual) return fallo("Archivo no encontrado", 404);
  const f = (await req.formData()).get("archivo");
  if (!(f instanceof File)) return fallo("No llegó ningún archivo");
  if (!PERMITIDOS.test(f.name)) return fallo("Tipo de archivo no admitido (PDF, Word, Excel o imagen).");
  if (f.size > MAX_BYTES) return fallo("El archivo supera 30 MB.");
  // Se reclasifica por el nombre nuevo; si no se reconoce, conserva el tipo que tenía (p. ej. una nueva versión del acta con otro nombre).
  const c = clasificarArchivo(f.name, null, f.type);
  const tipo = c.tipo === "otro" ? (actual.tipo as TipoArchivo) : c.tipo;
  try {
    await reemplazarArchivo(aid, id, { nombre: f.name, tipo, mime: f.type || "application/octet-stream", recinto: tipo === "foto" ? (c.recinto ?? actual.recinto) : null, contenido: Buffer.from(await f.arrayBuffer()) });
  } catch {
    return fallo("Ese mismo documento ya está cargado en el caso.", 409);
  }
  await auditar(u.id, id, "archivos.reemplazar", { archivo: aid, nombre: f.name, tipo });
  return json({ ok: true, tipo });
});
