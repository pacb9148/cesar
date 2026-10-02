import { cerrarSesion } from "@/lib/auth";
import { json } from "@/lib/api";

export async function POST() {
  await cerrarSesion();
  return json({ ok: true });
}
