import { conUsuario, fallo, json } from "@/lib/api";
import { obtenerCaso } from "@/lib/caso/repositorio";
import { valorUF } from "@/lib/caso/procesar";

/**
 * Consulta la UF del día del siniestro en mindicador.cl (servicio lento: se reintenta una vez con tiempo largo). No guarda nada: la pantalla la muestra y el
 * usuario decide si la usa (se guarda con PATCH /datos, que valida el rango).
 */
export const GET = conUsuario<{ id: string }>(async (_req, u, { id }) => {
  const caso = await obtenerCaso(id, u.id);
  if (!caso) return fallo("Caso no encontrado", 404);
  const fecha = caso.datos.fechas?.ocurrencia;
  if (!fecha) return fallo("El caso no tiene fecha de siniestro: no se puede buscar la UF.", 422);
  const valor = await valorUF(fecha, 2, 20_000);
  return json({ fecha, valor });
});
