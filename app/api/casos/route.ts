import { conUsuario, json } from "@/lib/api";
import { auditar, crearCaso } from "@/lib/caso/repositorio";

export const POST = conUsuario(async (_req, u) => {
  const c = await crearCaso(u.id, "sin número");
  await auditar(u.id, c.id, "caso.crear");
  return json({ id: c.id }, 201);
});
