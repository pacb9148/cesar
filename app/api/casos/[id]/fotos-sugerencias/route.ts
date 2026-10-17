import { conUsuario, fallo, json } from "@/lib/api";
import { contenidoArchivo, listarArchivos, obtenerCaso } from "@/lib/caso/repositorio";
import { sugerirFotos } from "@/lib/fotos/sugerencias";

export const maxDuration = 120;
export const runtime = "nodejs";

/** Sugerencias para revisar las fotos antes de generar: duplicadas, borrosas, vista general y cantidad por estancia. Solo informa: no cambia nada. */
export const GET = conUsuario<{ id: string }>(async (_req, u, { id }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const fotos = await listarArchivos(id, "foto");
  const sugerencias = await sugerirFotos(
    fotos.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      recinto: f.recinto ?? "General",
      cargar: async () => {
        const a = await contenidoArchivo(f.id, id);
        if (!a) throw new Error("sin contenido");
        return a.contenido;
      },
    })),
  );
  return json({ total: fotos.length, sugerencias });
});
