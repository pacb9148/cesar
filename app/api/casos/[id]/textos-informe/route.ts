import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { actualizarCaso, auditar, obtenerCaso } from "@/lib/caso/repositorio";
import { sincronizarTextos } from "@/lib/caso/edicion-documentos";

export const maxDuration = 180;
export const runtime = "nodejs";

const cuerpo = z.object({ caracteristicas: z.string().max(2000), evidencia: z.string().max(6000) });

/** «Guardar e insertar»: guarda los textos corregidos en «Datos» y, si el informe ya existe, los inserta en él sin rehacer el resto del documento. */
export const PUT = conUsuario<{ id: string }>(async (req, u, { id }) => {
  const caso = await obtenerCaso(id, u.id);
  if (!caso) return fallo("Caso no encontrado", 404);
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Texto inválido");
  await actualizarCaso(id, { datos: { ...caso.datos, textos: { caracteristicas: p.data.caracteristicas.trim(), evidencia: p.data.evidencia.trim() } } as typeof caso.datos });
  await auditar(u.id, id, "caso.editar_textos_informe", { caracteres: p.data.caracteristicas.length + p.data.evidencia.length });
  try {
    const r = await sincronizarTextos(id, u.id);
    return json({ ok: true, ...r });
  } catch (e) {
    return fallo(e instanceof Error ? e.message : "No se pudo insertar en el informe", 422);
  }
});
