/** Mueve `id` a la posición `pos` (1 = primera) dentro de la lista de fotos de un grupo y devuelve el nuevo orden; una posición fuera de rango se lleva al extremo. */
export function reordenar(ids: string[], id: string, pos: number): string[] {
  const sin = ids.filter((x) => x !== id);
  const destino = Math.min(sin.length, Math.max(0, Math.round(pos) - 1));
  return [...sin.slice(0, destino), id, ...sin.slice(destino)];
}

/**
 * Ordena las fotos de cada estancia por el índice que puso el usuario (`edicion.orden`, de izquierda a derecha); las que no tienen
 * índice conservan su orden original y van después. Las estancias salen en el orden en que aparecen.
 */
export function ordenarPorGrupo<T extends { recinto: string; edicion?: { orden?: number } | null }>(fotos: T[]): T[] {
  const grupos = new Map<string, { f: T; i: number }[]>();
  fotos.forEach((f, i) => grupos.set(f.recinto, [...(grupos.get(f.recinto) ?? []), { f, i }]));
  return [...grupos.values()].flatMap((g) => g.sort((a, b) => (a.f.edicion?.orden ?? Infinity) - (b.f.edicion?.orden ?? Infinity) || a.i - b.i).map((x) => x.f));
}

const normaliza = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Posición de la sección del presupuesto que corresponde a la estancia: igual (2) o una contiene a la otra (1); -1 si ninguna. */
export function posicionEnPresupuesto(recinto: string, secciones: string[]): number {
  const r = normaliza(recinto);
  if (!r) return -1;
  const igual = secciones.findIndex((s) => normaliza(s) === r);
  if (igual >= 0) return igual;
  return secciones.findIndex((s) => {
    const n = normaliza(s);
    return n !== "" && (n.includes(r) || r.includes(n));
  });
}

/**
 * Pone las estancias de las fotos en el mismo orden que las secciones del presupuesto. Las que no corresponden a ninguna sección
 * van al final, en su orden original; dentro de cada estancia las fotos conservan su orden.
 */
export function ordenarGruposPorPresupuesto<T extends { recinto: string }>(fotos: T[], secciones: string[]): T[] {
  if (secciones.length === 0) return fotos;
  const recintos = [...new Set(fotos.map((f) => f.recinto))];
  const clave = new Map(recintos.map((r, i) => [r, { pos: posicionEnPresupuesto(r, secciones), i }]));
  const orden = [...recintos].sort((a, b) => {
    const pa = clave.get(a)!;
    const pb = clave.get(b)!;
    const ka = pa.pos >= 0 ? pa.pos : Infinity;
    const kb = pb.pos >= 0 ? pb.pos : Infinity;
    return ka - kb || pa.i - pb.i;
  });
  return orden.flatMap((r) => fotos.filter((f) => f.recinto === r));
}

/**
 * Arrastrar y soltar una foto sobre otra: la arrastrada ocupa el lugar de la de destino (si venía de antes, queda detrás; si venía de después, delante).
 * Una foto que aún no iba al informe entra en esa posición. Si el destino no está en la lista no cambia nada.
 */
export function soltarFoto(ids: string[], arrastrada: string, destino: string): string[] {
  if (arrastrada === destino || !ids.includes(destino)) return ids;
  const sin = ids.filter((x) => x !== arrastrada);
  const k = sin.indexOf(destino);
  const desde = ids.indexOf(arrastrada);
  const idx = desde >= 0 && desde < ids.indexOf(destino) ? k + 1 : k;
  return [...sin.slice(0, idx), arrastrada, ...sin.slice(idx)];
}

/** ¿Son la misma estancia? Igual sin mayúsculas ni tildes, o una contiene a la otra («Living» y «Living Comedor»). */
export function coincideEstancia(a: string, b: string): boolean {
  const x = normaliza(a);
  const y = normaliza(b);
  return x !== "" && y !== "" && (x === y || x.includes(y) || y.includes(x));
}
