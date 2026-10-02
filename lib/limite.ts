/** Limitador simple en memoria para el inicio de sesión (un proceso). Suficiente para frenar fuerza bruta básica. */
const intentos = new Map<string, { n: number; hasta: number }>();
const VENTANA = 15 * 60 * 1000;
const MAX = 8;

export function permitido(clave: string): boolean {
  const r = intentos.get(clave);
  if (!r || r.hasta < Date.now()) return true;
  return r.n < MAX;
}
export function fallido(clave: string) {
  const r = intentos.get(clave);
  if (!r || r.hasta < Date.now()) intentos.set(clave, { n: 1, hasta: Date.now() + VENTANA });
  else r.n++;
}
export function limpiar(clave: string) {
  intentos.delete(clave);
}
