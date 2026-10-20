import sharp from "sharp";
import { conUsuario, fallo, json } from "@/lib/api";
import { clasificarArchivo, FORMATOS_DOCUMENTO, type TipoArchivo } from "@/lib/caso/clasificar";
import { aplicarEdicion } from "@/lib/fotos/aplicar";
import { esEdicionNula, PROPORCION_FOTO } from "@/lib/fotos/recorte";
import { auditar, contenidoArchivo, edicionDeFoto, eliminarArchivo, obtenerCaso, reemplazarArchivo } from "@/lib/caso/repositorio";

// Ancho de la miniatura: el doble del que se ve en pantalla, para que la captura de la previsualización (que se copia a 8,66 × 6,70 cm) salga nítida.
const MINIATURA_PX = 720;

export const GET = conUsuario<{ id: string; aid: string }>(async (req, u, { id, aid }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const a = await contenidoArchivo(aid, id);
  if (!a) return fallo("Archivo no encontrado", 404);
  const q = new URL(req.url).searchParams;
  const descargar = q.get("descargar") === "1";
  // Miniatura para las galerías: evita descargar la foto completa solo para mostrar un cuadro pequeño.
  if (q.get("miniatura") === "1" && a.mime.startsWith("image/")) {
    // Si el usuario editó la foto (giro, recorte, ajustes), la miniatura es la foto tal como irá en el informe, no el original.
    const edicion = await edicionDeFoto(aid, id);
    const mini =
      edicion && !esEdicionNula(edicion)
        ? await aplicarEdicion(a.contenido, edicion, { ancho: MINIATURA_PX, alto: Math.round(MINIATURA_PX / PROPORCION_FOTO) }, 75)
        : // Sin edición, el mismo recorte que lleva el informe (proporción 8,66 × 6,70 cm, encuadre inteligente): lo que se ve es lo que se inserta y se copia.
          await sharp(a.contenido).rotate().resize(MINIATURA_PX, Math.round(MINIATURA_PX / PROPORCION_FOTO), { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 75 }).toBuffer();
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
const PERMITIDOS = FORMATOS_DOCUMENTO;

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
