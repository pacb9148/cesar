import { configDe, registrarPrueba } from "./repo-proveedores";
import { crearCliente, incoherencia, probarCliente, type ResultadoPrueba } from "./proveedores";

/** Prueba de extremo a extremo del proveedor guardado y aplica el resultado: si todo está correcto, entra en servicio. */
export async function probarYRegistrar(usuarioId: string, id: string): Promise<ResultadoPrueba> {
  const cfg = await configDe(usuarioId, id);
  if (!cfg) return { ok: false, ms: 0, error: "Proveedor no encontrado." };
  let r: ResultadoPrueba;
  const motivo = incoherencia(cfg);
  if (motivo) {
    r = { ok: false, ms: 0, error: motivo };
    await registrarPrueba(usuarioId, id, r);
    return r;
  }
  try {
    r = await probarCliente(crearCliente(cfg));
  } catch (e) {
    r = { ok: false, ms: 0, error: e instanceof Error ? e.message : "Configuración inválida" };
  }
  await registrarPrueba(usuarioId, id, r);
  return r;
}
