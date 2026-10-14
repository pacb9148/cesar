import { conUsuario, json } from "@/lib/api";
import { auditar, crearOReutilizarCasoVacio } from "@/lib/caso/repositorio";

/** Crea un caso nuevo, o devuelve el caso vacío que ya existe para no acumular casos en blanco. */
export const POST = conUsuario(async (_req, u) => {
  const { caso, reutilizado } = await crearOReutilizarCasoVacio(u.id);
  if (!reutilizado) await auditar(u.id, caso.id, "caso.crear");
  return json({ id: caso.id, reutilizado }, reutilizado ? 200 : 201);
});
