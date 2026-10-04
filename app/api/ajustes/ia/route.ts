import { z } from "zod";
import { conUsuario, fallo, json } from "@/lib/api";
import { auditar } from "@/lib/caso/repositorio";
import { campoClave, campoModelo } from "@/lib/ia/validacion";
import { PRESETS, TIPOS, baseUrlDe, incoherencia } from "@/lib/ia/proveedores";
import { crearProveedor, listarProveedores } from "@/lib/ia/repo-proveedores";
import { probarYRegistrar } from "@/lib/ia/servicio-proveedores";

export const maxDuration = 120;

const nuevo = z.object({
  tipo: z.enum(TIPOS),
  baseUrl: z.string().trim().max(200).optional(),
  modelo: campoModelo,
  clave: campoClave,
  nombre: z.string().trim().max(60).optional(),
});

export const GET = conUsuario(async (_req, u) => json({ proveedores: await listarProveedores(u.id) }));

/** Agrega un proveedor y lo prueba al instante: si la prueba sale bien entra en servicio; si no, queda guardado fuera de servicio con el motivo. */
export const POST = conUsuario(async (req, u) => {
  const p = nuevo.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos inválidos");
  const motivo = incoherencia(p.data);
  if (motivo) return fallo(motivo);
  let baseUrl: string | null;
  try {
    baseUrl = baseUrlDe({ tipo: p.data.tipo, baseUrl: p.data.baseUrl ?? null });
  } catch (e) {
    return fallo(e instanceof Error ? e.message : "URL base inválida");
  }
  const id = await crearProveedor(u.id, { nombre: p.data.nombre || PRESETS[p.data.tipo].etiqueta.split(" (")[0], tipo: p.data.tipo, baseUrl: PRESETS[p.data.tipo].baseUrl ? null : baseUrl, modelo: p.data.modelo, clave: p.data.clave });
  const prueba = await probarYRegistrar(u.id, id);
  // La auditoría registra el hecho y el destino, jamás la clave.
  await auditar(u.id, null, "ia.agregar_proveedor", { tipo: p.data.tipo, modelo: p.data.modelo, probado: prueba.ok });
  return json({ id, prueba, proveedores: await listarProveedores(u.id) }, 201);
});
