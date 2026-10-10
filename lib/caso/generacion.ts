import { createHash } from "node:crypto";
import { consulta, uno } from "../db";
import { guardarExtraccion, leerExtraccion } from "./repositorio";

/** Lo que el usuario puede cambiar y que debe reflejarse en el informe: archivos, recortes y selección de fotos, ajuste, datos y leyendas de grupo. */
export async function huellaEntradas(casoId: string): Promise<string> {
  const archivos = await consulta<{ id: string; sha256: string; recinto: string | null; edicion: unknown }>(
    "select id, sha256, recinto, edicion from archivos where caso_id = $1 and tipo not in ('salida', 'meteo_png') order by id",
    [casoId],
  );
  const ajuste = await uno<{ version: number }>("select version from ajustes where caso_id = $1 order by version desc limit 1", [casoId]);
  const caso = await uno<{ datos: Record<string, unknown>; valor_uf: number | null }>("select datos, valor_uf from casos where id = $1", [casoId]);
  const rec = await uno<{ hash: string }>("select hash from reclamaciones where caso_id = $1", [casoId]);
  const { alertas: _alertas, ...datos } = caso?.datos ?? {};
  void _alertas; // los avisos de lectura cambian al releer sin que cambie nada del informe
  const grupos = await leerExtraccion(casoId, "leyendas_grupos");
  return createHash("sha256").update(JSON.stringify({ archivos, ajuste: ajuste?.version ?? null, datos, uf: caso?.valor_uf ?? null, rec: rec?.hash ?? null, grupos })).digest("hex");
}

/** Anota con qué entradas se generó el informe; si después cambian, el botón «Volver a generar» se activa. */
export async function marcarAlDia(casoId: string): Promise<void> {
  await guardarExtraccion(casoId, "generacion", { huella: await huellaEntradas(casoId), en: new Date().toISOString() });
}

export async function informeAlDia(casoId: string): Promise<boolean> {
  const g = await leerExtraccion<{ huella: string }>(casoId, "generacion");
  return !!g && g.huella === (await huellaEntradas(casoId));
}

export const leerLeyendasGrupos = async (casoId: string): Promise<Record<string, string>> => (await leerExtraccion<Record<string, string>>(casoId, "leyendas_grupos")) ?? {};
