import { consulta, transaccion, uno } from "../db";
import { cifrar, descifrar } from "./cifrado";
import { ClienteGemini } from "./gemini";
import { baseUrlDe, crearCliente, type ConfigProveedor, type ResultadoPrueba, type TipoProveedor } from "./proveedores";
import type { Candidato, InfoFallo, RegistroSalud } from "./rotacion";

export const MAX_PROVEEDORES = 10;

export type ProveedorVista = {
  id: string;
  nombre: string;
  tipo: TipoProveedor;
  baseUrl: string | null;
  modelo: string;
  ultimos4: string;
  prioridad: number;
  activo: boolean;
  estado: "sin_probar" | "ok" | "error";
  ultimoError: string | null;
  ultimaPrueba: string | null;
  ultimoExito: string | null;
  enPausaHasta: string | null;
};

type Fila = {
  id: string; nombre: string; tipo: TipoProveedor; base_url: string | null; modelo: string; ultimos4: string; prioridad: number; activo: boolean;
  estado: ProveedorVista["estado"]; ultimo_error: string | null; ultima_prueba: string | null; ultimo_exito: string | null; en_pausa_hasta: string | null; fallos_seguidos: number;
};

const COLS = "id, nombre, tipo, base_url, modelo, ultimos4, prioridad, activo, estado, ultimo_error, ultima_prueba, ultimo_exito, en_pausa_hasta, fallos_seguidos";

const vista = (f: Fila): ProveedorVista => ({
  id: f.id, nombre: f.nombre, tipo: f.tipo, baseUrl: f.base_url, modelo: f.modelo, ultimos4: f.ultimos4, prioridad: f.prioridad, activo: f.activo,
  estado: f.estado, ultimoError: f.ultimo_error, ultimaPrueba: f.ultima_prueba, ultimoExito: f.ultimo_exito, enPausaHasta: f.en_pausa_hasta,
});

/** Lo único que sale hacia el navegador: nunca la clave, solo sus últimos 4 caracteres. */
export async function listarProveedores(usuarioId: string): Promise<ProveedorVista[]> {
  return (await consulta<Fila>(`select ${COLS} from proveedores_ia where usuario_id = $1 order by prioridad, creado`, [usuarioId])).map(vista);
}

export async function crearProveedor(usuarioId: string, p: { nombre: string; tipo: TipoProveedor; baseUrl: string | null; modelo: string; clave: string }): Promise<string> {
  const n = (await uno<{ n: number }>("select count(*)::int as n from proveedores_ia where usuario_id = $1", [usuarioId]))?.n ?? 0;
  if (n >= MAX_PROVEEDORES) throw new Error(`Máximo ${MAX_PROVEEDORES} proveedores por usuario.`);
  const r = await uno<{ id: string }>(
    `insert into proveedores_ia(usuario_id, nombre, tipo, base_url, modelo, clave_cifrada, ultimos4, prioridad)
     values ($1,$2,$3,$4,$5,$6,$7,(select coalesce(max(prioridad),0)+1 from proveedores_ia where usuario_id = $1)) returning id`,
    [usuarioId, p.nombre, p.tipo, p.baseUrl, p.modelo, cifrar(p.clave), p.clave.slice(-4)],
  );
  return r!.id;
}

/** Configuración completa (con la clave descifrada) para uso interno del servidor. */
export async function configDe(usuarioId: string, id: string): Promise<(ConfigProveedor & { nombre: string }) | null> {
  const f = await uno<{ nombre: string; tipo: TipoProveedor; base_url: string | null; modelo: string; clave_cifrada: string }>(
    "select nombre, tipo, base_url, modelo, clave_cifrada from proveedores_ia where id = $1 and usuario_id = $2",
    [id, usuarioId],
  );
  return f ? { nombre: f.nombre, tipo: f.tipo, baseUrl: f.base_url, modelo: f.modelo, clave: descifrar(f.clave_cifrada) } : null;
}

export async function actualizarProveedor(usuarioId: string, id: string, c: { nombre?: string; modelo?: string; baseUrl?: string | null; clave?: string; activo?: boolean }) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const poner = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (c.nombre !== undefined) poner("nombre", c.nombre);
  if (c.modelo !== undefined) poner("modelo", c.modelo);
  if (c.baseUrl !== undefined) poner("base_url", c.baseUrl);
  if (c.clave !== undefined) {
    poner("clave_cifrada", cifrar(c.clave));
    poner("ultimos4", c.clave.slice(-4));
  }
  if (c.activo !== undefined) poner("activo", c.activo);
  if (sets.length === 0) return;
  vals.push(id, usuarioId);
  await consulta(`update proveedores_ia set ${sets.join(", ")} where id = $${vals.length - 1} and usuario_id = $${vals.length}`, vals);
}

export async function eliminarProveedor(usuarioId: string, id: string) {
  await consulta("delete from proveedores_ia where id = $1 and usuario_id = $2", [id, usuarioId]);
  await renumerar(usuarioId);
}

async function renumerar(usuarioId: string) {
  await transaccion(async (q) => {
    const ids = (await q<{ id: string }>("select id from proveedores_ia where usuario_id = $1 order by prioridad, creado", [usuarioId])).map((r) => String(r.id));
    for (const [i, id] of ids.entries()) await q("update proveedores_ia set prioridad = $1 where id = $2", [i + 1, id]);
  });
}

export async function moverProveedor(usuarioId: string, id: string, dir: "subir" | "bajar") {
  await transaccion(async (q) => {
    const ids = (await q<{ id: string }>("select id from proveedores_ia where usuario_id = $1 order by prioridad, creado", [usuarioId])).map((r) => String(r.id));
    const i = ids.indexOf(id);
    const j = dir === "subir" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    for (const [k, x] of ids.entries()) await q("update proveedores_ia set prioridad = $1 where id = $2", [k + 1, x]);
  });
}

/**
 * Aplica el resultado de una prueba manual o automática: si salió bien, el proveedor entra en servicio;
 * si no, queda guardado pero fuera de servicio con el motivo a la vista.
 */
export async function registrarPrueba(usuarioId: string, id: string, r: ResultadoPrueba) {
  await consulta(
    r.ok
      ? `update proveedores_ia set estado = 'ok', activo = true, ultimo_error = null, ultima_prueba = now(), ultimo_exito = now(), fallos_seguidos = 0, en_pausa_hasta = null where id = $1 and usuario_id = $2`
      : `update proveedores_ia set estado = 'error', activo = false, ultimo_error = $3, ultima_prueba = now() where id = $1 and usuario_id = $2`,
    r.ok ? [id, usuarioId] : [id, usuarioId, (r.error ?? "Error").slice(0, 300)],
  );
}

/** Estado de salud en la base de datos para el cliente con respaldo. */
/** Host al que se conectará un proveedor (para mostrarlo; nunca incluye la clave). */
export function destinoDe(tipo: TipoProveedor, baseUrl: string | null): string {
  try {
    return baseUrlDe({ tipo, baseUrl }) ?? "API de Google";
  } catch {
    return "URL inválida";
  }
}

export class RegistroDb implements RegistroSalud {
  constructor(private usuarioId: string) {}

  async candidatos(): Promise<Candidato[]> {
    const filas = await consulta<{ id: string; nombre: string; tipo: TipoProveedor; base_url: string | null; modelo: string; clave_cifrada: string; fallos_seguidos: number; pausado: boolean }>(
      `select id, nombre, tipo, base_url, modelo, clave_cifrada, fallos_seguidos, (en_pausa_hasta is not null and en_pausa_hasta > now()) as pausado
       from proveedores_ia where usuario_id = $1 and activo order by pausado, prioridad`,
      [this.usuarioId],
    );
    const lista: Candidato[] = [];
    for (const f of filas) {
      try {
        const cliente = crearCliente({ tipo: f.tipo, baseUrl: f.base_url, modelo: f.modelo, clave: descifrar(f.clave_cifrada) });
        lista.push({ id: String(f.id), nombre: String(f.nombre), cliente, fallosSeguidos: Number(f.fallos_seguidos), pausado: !!f.pausado, detalle: `${f.modelo} · ${destinoDe(f.tipo, f.base_url)}` });
      } catch (e) {
        // Una configuración ilegible (clave que no se puede descifrar, URL inválida) no tumba a los demás.
        await this.fallo(String(f.id), { error: e instanceof Error ? e.message : "Configuración inválida", pausaS: 3600, desactivar: true });
      }
    }
    // Respaldo del administrador: solo cuando el usuario no tiene ningún proveedor propio.
    if (filas.length === 0 && process.env.GEMINI_API_KEY) {
      lista.push({ id: null, nombre: "Gemini (respaldo del servidor)", cliente: new ClienteGemini(), fallosSeguidos: 0, pausado: false });
    }
    return lista;
  }

  async ok(id: string | null) {
    if (!id) return;
    await consulta("update proveedores_ia set estado = 'ok', ultimo_error = null, ultimo_exito = now(), fallos_seguidos = 0, en_pausa_hasta = null where id = $1", [id]);
  }

  async fallo(id: string | null, info: InfoFallo) {
    if (!id) return;
    await consulta(
      `update proveedores_ia set estado = 'error', ultimo_error = $2, fallos_seguidos = fallos_seguidos + 1,
         en_pausa_hasta = now() + ($3 || ' seconds')::interval, activo = activo and not $4 where id = $1`,
      [id, info.error.slice(0, 300), String(info.pausaS), info.desactivar],
    );
  }
}

export async function hayProveedorActivo(usuarioId: string): Promise<boolean> {
  const n = (await uno<{ n: number }>("select count(*)::int as n from proveedores_ia where usuario_id = $1 and activo", [usuarioId]))?.n ?? 0;
  return n > 0 || !!process.env.GEMINI_API_KEY;
}
