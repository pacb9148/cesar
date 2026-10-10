import { CANTIDAD_PREVENTIVA } from "../domain/constantes";

/**
 * Ninguna partida se ajusta a 0: el mínimo es 1. Si lo reclamado ya era menor que 1 se respeta eso, porque el ajuste
 * jamás supera lo reclamado. Una partida sin reclamación (adicional del perito) parte de 1.
 */
export const cantidadMinima = (reclamada?: number | null): number =>
  reclamada != null && reclamada > 0 && reclamada < CANTIDAD_PREVENTIVA ? reclamada : CANTIDAD_PREVENTIVA;

export const conMinimo = (cantidad: number, reclamada?: number | null): number => Math.max(cantidad, cantidadMinima(reclamada));
