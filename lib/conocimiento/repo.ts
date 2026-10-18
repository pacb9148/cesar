import { consulta } from "../db";
import type { Reclamacion, SalidaAgente } from "../domain/tipos";
import { aprendidoVacio, normClave, type Aprendido } from "./index";

type Fila = { tipo: "partida" | "elemento"; clave: string; valor: Record<string, unknown>; veces: number; actualizado: string };

/** Lo aprendido de este usuario, listo para consultar. Sin la tabla (migración pendiente) devuelve una memoria vacía. */
export async function leerAprendido(usuarioId: string): Promise<Aprendido> {
  const a = aprendidoVacio();
  const filas = await consulta<Fila>("select tipo, clave, valor, veces, actualizado from conocimiento where usuario_id = $1", [usuarioId]).catch(() => [] as Fila[]);
  for (const f of filas) {
    if (f.tipo === "partida") {
      a.partidas.set(f.clave, new Map(Object.entries((f.valor.ids ?? {}) as Record<string, number>).map(([id, n]) => [Number(id), n])));
    } else {
      const ids = (f.valor.ids ?? {}) as Record<string, { veces: number; um: string }>;
      a.elementos.set(f.clave, { secciones: Number(f.valor.secciones ?? 0), ids: new Map(Object.entries(ids).map(([id, v]) => [Number(id), v])) });
    }
  }
  return a;
}

async function sumar(usuarioId: string, tipo: "partida" | "elemento", clave: string, cambio: (valor: Record<string, unknown>) => Record<string, unknown>) {
  const f = (await consulta<{ valor: Record<string, unknown> }>("select valor from conocimiento where usuario_id = $1 and tipo = $2 and clave = $3", [usuarioId, tipo, clave]))[0];
  const valor = cambio(f?.valor ?? {});
  await consulta(
    `insert into conocimiento(usuario_id, tipo, clave, valor, veces) values ($1, $2, $3, $4::jsonb, 1)
     on conflict (usuario_id, tipo, clave) do update set valor = excluded.valor, veces = conocimiento.veces + 1, actualizado = now()`,
    [usuarioId, tipo, clave, JSON.stringify(valor)],
  );
}

const idDe = (origen: string | null | undefined): number | null => {
  const m = /^baremo:(\d+)$/.exec(origen ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * Aprende de un ajuste guardado: cada partida del presupuesto cuyo precio se tomó de la hoja Datos refuerza «esta descripción → esta partida», y las
 * partidas que el liquidador agregó por elemento refuerzan «en un cielo se suele agregar esto». Nunca rompe el flujo: si falla, se ignora.
 */
export async function aprenderDeAjuste(usuarioId: string, e: { reclamacion: Reclamacion | null; salida: SalidaAgente }): Promise<{ partidas: number; elementos: number }> {
  let partidas = 0;
  let elementos = 0;
  try {
    const desc = new Map((e.reclamacion?.lineas ?? []).map((l) => [l.item, l.descripcion]));
    const asociar = async (texto: string, id: number) => {
      const clave = normClave(texto);
      if (!clave) return;
      await sumar(usuarioId, "partida", clave, (v) => {
        const ids = { ...((v.ids ?? {}) as Record<string, number>) };
        ids[String(id)] = (ids[String(id)] ?? 0) + 1;
        return { ids };
      });
      partidas++;
    };
    for (const d of e.salida.lineas) {
      const id = idDe(d.pu_origen);
      const texto = desc.get(d.item);
      if (id !== null && texto && d.accion === "ajustar") await asociar(texto, id);
    }
    for (const a of e.salida.lineas_adicionales) {
      const id = idDe(a.pu_origen);
      if (id !== null) await asociar(a.descripcion, id);
    }
    // Por elemento: cada estancia cuenta una vez, y cada partida una vez por estancia.
    const grupos = new Map<string, Map<number, string>>();
    for (const a of e.salida.lineas_adicionales) {
      const id = idDe(a.pu_origen);
      const el = normClave(a.elemento ?? "");
      if (id === null || !el) continue;
      const k = `${el}|${normClave(a.seccion)}`;
      grupos.set(k, (grupos.get(k) ?? new Map()).set(id, a.um));
    }
    for (const [k, ids] of grupos) {
      const el = k.split("|")[0];
      await sumar(usuarioId, "elemento", el, (v) => {
        const mapa = { ...((v.ids ?? {}) as Record<string, { veces: number; um: string }>) };
        for (const [id, um] of ids) mapa[String(id)] = { veces: (mapa[String(id)]?.veces ?? 0) + 1, um };
        return { secciones: Number(v.secciones ?? 0) + 1, ids: mapa };
      });
      elementos++;
    }
  } catch {
    /* aprender es un extra: un fallo aquí no debe afectar al ajuste */
  }
  return { partidas, elementos };
}

export type EntradaMemoria = { tipo: "partida" | "elemento"; clave: string; resumen: string; veces: number; actualizado: string };

export async function listarMemoria(usuarioId: string): Promise<EntradaMemoria[]> {
  const filas = await consulta<Fila>("select tipo, clave, valor, veces, actualizado from conocimiento where usuario_id = $1 order by veces desc, actualizado desc limit 500", [usuarioId]).catch(() => [] as Fila[]);
  return filas.map((f) => ({ tipo: f.tipo, clave: f.clave, veces: f.veces, actualizado: f.actualizado, resumen: JSON.stringify(f.valor.ids ?? {}) }));
}

export async function olvidar(usuarioId: string, tipo: string, clave: string): Promise<void> {
  await consulta("delete from conocimiento where usuario_id = $1 and tipo = $2 and clave = $3", [usuarioId, tipo, clave]);
}
