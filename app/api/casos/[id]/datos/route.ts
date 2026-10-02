import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { actualizarCaso, auditar, obtenerCaso } from "@/lib/caso/repositorio";

const fecha = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "Usa el formato dd/mm/aaaa");

/** Campos que el usuario puede corregir a mano. Todo lo demás viene de los documentos. */
const cuerpo = z
  .object({
    siniestro: z.string().min(1).max(30),
    liquidacion: z.string().min(1).max(30),
    asegurado: z.object({ nombre: z.string().min(2).max(120), rut: z.string().max(20), direccion: z.string().max(200) }).partial(),
    ubicacion: z.string().max(240),
    denunciaTexto: z.string().max(4000).nullable(),
    fechas: z.object({ emision: fecha.nullable(), informadoPartes: fecha.nullable() }).partial(),
    poliza: z.object({ sumaAseguradaUF: z.number().nonnegative(), deducibleUF: z.number().nonnegative() }).partial(),
    valor_uf: z.number().positive(),
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
    asegurado: { ...d.asegurado, ...resto.asegurado },
    fechas: { ...d.fechas, ...resto.fechas },
    poliza: { ...d.poliza, ...resto.poliza },
  } as typeof d;
  await actualizarCaso(id, { datos: nuevo, ...(valor_uf ? { valor_uf } : {}), ...(resto.siniestro ? { siniestro: resto.siniestro } : {}) });
  await auditar(u.id, id, "caso.editar_datos", { campos: Object.keys(p.data) });
  return json({ ok: true });
});
