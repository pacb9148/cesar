import { createHash } from "node:crypto";
import { consulta, transaccion, uno } from "../db";
import type { DatosCaso, Reclamacion, SalidaAgente } from "../domain/tipos";
import type { EdicionFoto } from "../fotos/recorte";
import type { TipoArchivo } from "./clasificar";

export type Caso = {
  id: string;
  usuario_id: string;
  siniestro: string;
  estado: string;
  modo: "reclamacion" | "perdida_determinada";
  datos: Partial<DatosCaso> & { alertas?: string[]; manual?: Record<string, unknown> };
  valor_uf: number | null;
  creado: string;
  actualizado: string;
};

export type ArchivoMeta = {
  id: string;
  caso_id: string;
  nombre: string;
  tipo: string;
  mime: string;
  tamano: number;
  recinto: string | null;
  orden: number;
  /** Edición de la fotografía (recorte, giro, ajustes y si va al informe); null si no se tocó. */
  edicion: EdicionFoto | null;
};

const tocar = "update casos set actualizado = now() where id = $1";

export async function crearCaso(usuarioId: string, siniestro: string): Promise<Caso> {
  const c = await uno<Caso>("insert into casos(usuario_id, siniestro) values ($1,$2) returning *", [usuarioId, siniestro]);
  return c!;
}

export const listarCasos = (usuarioId: string) =>
  consulta<Caso>("select * from casos where usuario_id = $1 order by actualizado desc", [usuarioId]);

export const obtenerCaso = (id: string, usuarioId: string) =>
  uno<Caso>("select * from casos where id = $1 and usuario_id = $2", [id, usuarioId]);

export async function actualizarCaso(id: string, campos: Partial<Pick<Caso, "estado" | "modo" | "datos" | "valor_uf" | "siniestro">>) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(campos)) {
    vals.push(k === "datos" ? JSON.stringify(v) : v);
    sets.push(`${k} = $${vals.length}${k === "datos" ? "::jsonb" : ""}`);
  }
  vals.push(id);
  await consulta(`update casos set ${sets.join(", ")}, actualizado = now() where id = $${vals.length}`, vals);
}

export async function guardarArchivo(a: { casoId: string; nombre: string; tipo: TipoArchivo | "salida" | "meteo_png"; mime: string; recinto?: string | null; orden?: number; contenido: Buffer }) {
  const sha = createHash("sha256").update(a.contenido).digest("hex");
  const r = await uno<{ id: string }>(
    `insert into archivos(caso_id, nombre, tipo, mime, tamano, sha256, recinto, orden, contenido)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (caso_id, sha256, tipo) do update set nombre = excluded.nombre
     returning id`,
    [a.casoId, a.nombre, a.tipo, a.mime, a.contenido.length, sha, a.recinto ?? null, a.orden ?? 0, a.contenido],
  );
  await consulta(tocar, [a.casoId]);
  return r!.id;
}

export const listarArchivos = (casoId: string, tipo?: string) =>
  consulta<ArchivoMeta>(
    `select id, caso_id, nombre, tipo, mime, tamano, recinto, orden, edicion from archivos
     where caso_id = $1 ${tipo ? "and tipo = $2" : ""} order by tipo, recinto nulls first, orden, nombre`,
    tipo ? [casoId, tipo] : [casoId],
  );

export async function contenidoArchivo(id: string, casoId: string): Promise<{ nombre: string; mime: string; contenido: Buffer } | null> {
  return uno("select nombre, mime, contenido from archivos where id = $1 and caso_id = $2", [id, casoId]);
}

export async function archivosConContenido(casoId: string, tipo: string) {
  return consulta<{ id: string; nombre: string; mime: string; recinto: string | null; contenido: Buffer; edicion: EdicionFoto | null }>(
    "select id, nombre, mime, recinto, contenido, edicion from archivos where caso_id = $1 and tipo = $2 order by recinto nulls first, orden, nombre",
    [casoId, tipo],
  );
}

export async function guardarEdicionFoto(id: string, casoId: string, edicion: EdicionFoto | null): Promise<boolean> {
  const r = await uno<{ id: string }>("update archivos set edicion = $3::jsonb where id = $1 and caso_id = $2 and tipo = 'foto' returning id", [id, casoId, edicion ? JSON.stringify(edicion) : null]);
  if (r) await consulta(tocar, [casoId]);
  return !!r;
}

export async function eliminarArchivo(id: string, casoId: string) {
  await consulta("delete from archivos where id = $1 and caso_id = $2", [id, casoId]);
}

export async function guardarExtraccion(casoId: string, clave: string, valor: unknown) {
  await consulta(
    `insert into extracciones(caso_id, clave, valor) values ($1,$2,$3::jsonb)
     on conflict (caso_id, clave) do update set valor = excluded.valor, actualizado = now()`,
    [casoId, clave, JSON.stringify(valor)],
  );
}
export async function leerExtraccion<T>(casoId: string, clave: string): Promise<T | null> {
  const r = await uno<{ valor: T }>("select valor from extracciones where caso_id = $1 and clave = $2", [casoId, clave]);
  return r?.valor ?? null;
}

export async function guardarReclamacion(casoId: string, r: Reclamacion, hash: string) {
  await transaccion(async (q) => {
    await q("delete from reclamaciones where caso_id = $1", [casoId]);
    await q("insert into reclamaciones(caso_id, datos, hash) values ($1,$2::jsonb,$3)", [casoId, JSON.stringify(r), hash]);
  });
}
export const leerReclamacion = (casoId: string) => uno<{ datos: Reclamacion; hash: string }>("select datos, hash from reclamaciones where caso_id = $1", [casoId]);

export async function guardarAjuste(casoId: string, salida: SalidaAgente, origen: "agente" | "manual", modelo?: string, promptVersion?: string) {
  return transaccion(async (q) => {
    const v = ((await q<{ v: number }>("select coalesce(max(version),0)+1 as v from ajustes where caso_id = $1", [casoId]))[0].v) as number;
    await q("insert into ajustes(caso_id, version, salida, origen, modelo, prompt_version) values ($1,$2,$3::jsonb,$4,$5,$6)", [casoId, v, JSON.stringify(salida), origen, modelo ?? null, promptVersion ?? null]);
    await q(tocar, [casoId]);
    return v;
  });
}
export const ultimoAjuste = (casoId: string) =>
  uno<{ version: number; salida: SalidaAgente; origen: string; creado: string }>("select version, salida, origen, creado from ajustes where caso_id = $1 order by version desc limit 1", [casoId]);

export async function registrarLlm(r: { casoId: string; tarea: string; modelo: string; promptVersion: string; tin?: number; tout?: number; ok: boolean; error?: string }) {
  await consulta(
    "insert into llm_runs(caso_id, tarea, modelo, prompt_version, tokens_entrada, tokens_salida, ok, error) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [r.casoId, r.tarea, r.modelo, r.promptVersion, r.tin ?? null, r.tout ?? null, r.ok, r.error ?? null],
  );
}

export async function auditar(usuarioId: string | null, casoId: string | null, accion: string, detalle?: unknown) {
  await consulta("insert into auditoria(usuario_id, caso_id, accion, detalle) values ($1,$2,$3,$4::jsonb)", [usuarioId, casoId, accion, JSON.stringify(detalle ?? null)]);
}
