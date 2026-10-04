import { conUsuario, fallo, json } from "@/lib/api";
import { salidaAgenteSchema } from "@/lib/domain/tipos";
import { actualizarCaso, auditar, guardarAjuste, leerReclamacion, obtenerCaso, ultimoAjuste } from "@/lib/caso/repositorio";
import { completarConRespeto } from "@/lib/ia/motor-ajuste";
import { validarSalida } from "@/lib/ia/validadores";

export const GET = conUsuario<{ id: string }>(async (_req, u, { id }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  return json((await ultimoAjuste(id)) ?? null);
});

/** Guarda una edición manual como nueva versión del ajuste, validada con las mismas reglas que el agente. */
export const PUT = conUsuario<{ id: string }>(async (req, u, { id }) => {
  const caso = await obtenerCaso(id, u.id);
  if (!caso) return fallo("Caso no encontrado", 404);
  const p = salidaAgenteSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Ajuste inválido");
  const recl = (await leerReclamacion(id))?.datos;
  const salida = { ...p.data, lineas: recl && caso.modo === "reclamacion" ? completarConRespeto(recl.lineas, p.data.lineas) : p.data.lineas };
  const v = validarSalida(salida, {
    reclamacion: recl ?? { secciones: [], lineas: [], totalDirectoDeclarado: null, ggPct: 0.25, utilidadPct: 0, ivaPct: 0.19 },
    fotosIds: new Set(p.data.evidencia_observada.flatMap((e) => e.fotos)),
    fuentesMercado: new Set(
      [...p.data.lineas.flatMap((l) => [l.pu_origen, ...l.sublineas.map((s) => s.pu_origen)]), ...p.data.lineas_adicionales.map((l) => l.pu_origen)]
        .filter((o): o is string => !!o && o.startsWith("mercado:"))
        .map((o) => o.slice(8)),
    ),
    modo: caso.modo,
  });
  if (v.errores.length) return json({ errores: v.errores }, 422);
  const version = await guardarAjuste(id, salida, "manual");
  await actualizarCaso(id, { estado: "revisado" });
  await auditar(u.id, id, "ajuste.editar", { version });
  return json({ version, advertencias: v.advertencias });
});
