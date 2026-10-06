import sharp from "sharp";
import { conUsuario, fallo, json } from "@/lib/api";
import { contenidoArchivo, eliminarArchivo, obtenerCaso } from "@/lib/caso/repositorio";

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
