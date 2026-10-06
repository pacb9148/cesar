import { consulta } from "../db";
import { clasificacionSchema, type Clasificacion } from "../ia/motor-ajuste";

/**
 * Almacén temporal del análisis partida por partida. Cada resultado se guarda apenas llega; si el ajuste se interrumpe
 * (proveedor caído, corte), al repetirlo solo se analizan las partidas pendientes. Al consolidar se borra todo.
 * `huella` ata los resultados a esta reclamación y a esta versión de las instrucciones.
 */
export type ResultadoPartida = { ok: true; clasificacion: Clasificacion; modelo?: string } | { ok: false; error: string };

export async function cargarPrevias(casoId: string, huella: string): Promise<Map<string, Clasificacion>> {
  const filas = await consulta<{ item: string; clasificacion: unknown }>("select item, clasificacion from analisis_partidas where caso_id = $1 and huella = $2 and estado = 'ok'", [casoId, huella]);
  const out = new Map<string, Clasificacion>();
  for (const f of filas) {
    const p = clasificacionSchema.safeParse(f.clasificacion);
    if (p.success) out.set(String(f.item), p.data);
  }
  return out;
}

export async function guardarResultado(casoId: string, huella: string, item: string, r: ResultadoPartida): Promise<void> {
  await consulta(
    `insert into analisis_partidas(caso_id, huella, item, estado, clasificacion, error, modelo)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7)
     on conflict (caso_id, huella, item) do update set estado = excluded.estado, clasificacion = excluded.clasificacion, error = excluded.error, modelo = excluded.modelo, actualizado = now()`,
    [casoId, huella, item, r.ok ? "ok" : "error", r.ok ? JSON.stringify(r.clasificacion) : null, r.ok ? null : r.error.slice(0, 400), r.ok ? (r.modelo ?? null) : null],
  );
}

export async function limpiarAnalisis(casoId: string): Promise<void> {
  await consulta("delete from analisis_partidas where caso_id = $1", [casoId]);
}
