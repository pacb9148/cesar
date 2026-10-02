import { createHash } from "node:crypto";
import type { Reclamacion } from "../domain/tipos";

/** Hash canónico de la columna Reclamación: si cambia una coma, cambia el hash. */
export function hashReclamacion(r: Reclamacion): string {
  const canon = r.lineas.map((l) => [l.item, l.recinto, l.descripcion, l.um, l.cantidad, l.pu]);
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}
