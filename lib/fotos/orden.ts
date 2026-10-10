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
