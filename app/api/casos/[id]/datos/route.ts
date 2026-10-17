import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { actualizarCaso, auditar, casoConSiniestro, obtenerCaso } from "@/lib/caso/repositorio";

const fecha = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "Usa el formato dd/mm/aaaa");

/** Campos que el usuario puede corregir a mano. Todo lo demás viene de los documentos. */
const cuerpo = z
  .object({
    siniestro: z.string().min(1).max(30),
    liquidacion: z.string().min(1).max(30),
    asegurado: z.object({ nombre: z.string().min(2).max(120), rut: z.string().max(20), direccion: z.string().max(200), genero: z.enum(["m", "f"]).nullable() }).partial(),
    ubicacion: z.string().max(240),
    denunciaTexto: z.string().max(4000).nullable(),
    fechas: z.object({ emision: fecha.nullable(), informadoPartes: fecha.nullable() }).partial(),
    poliza: z.object({ sumaAseguradaUF: z.number().nonnegative(), deducibleUF: z.number().nonnegative() }).partial(),
    textos: z.object({ caracteristicas: z.string().max(2000), evidencia: z.string().max(6000) }).partial(),
    entrega: z.object({ calidad: z.enum(["150", "300"]), anexoCompacto: z.boolean() }),
    // La UF ronda los 40.000 pesos: un valor fuera de rango es un error de tipeo (p. ej. 4.084.479 por borrar el decimal).
    valor_uf: z.number().min(1000, "La UF parece demasiado baja").max(200000, "La UF parece demasiado alta: revisa el punto y la coma decimal"),
  })
  .partial();

export const PATCH = conUsuario<{ id: string }>(async (req, u, { id }) => {
  const caso = await obtenerCaso(id, u.id);
  if (!caso) return fallo("Caso no encontrado", 404);
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos inválidos");
  const { valor_uf, ...resto } = p.data;
  const d = caso.datos;
  const nuevo = {
    ...d,
    ...resto,
    asegurado: { ...d.asegurado, ...resto.asegurado, ...(resto.asegurado?.genero === null ? { genero: undefined } : {}) },
    fechas: { ...d.fechas, ...resto.fechas },
    poliza: { ...d.poliza, ...resto.poliza },
    ...(resto.textos ? { textos: { ...d.textos, ...resto.textos } } : {}),
  } as typeof d;
  if (resto.siniestro) {
    const otro = await casoConSiniestro(u.id, resto.siniestro, id);
    if (otro) return fallo(`Ya existe otro caso con el siniestro ${resto.siniestro}.`, 409);
  }
  await actualizarCaso(id, { datos: nuevo, ...(valor_uf ? { valor_uf } : {}), ...(resto.siniestro ? { siniestro: resto.siniestro } : {}) });
  await auditar(u.id, id, "caso.editar_datos", { campos: Object.keys(p.data) });
  return json({ ok: true });
});
