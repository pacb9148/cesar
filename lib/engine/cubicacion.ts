import { FACTOR_VANOS } from "../domain/constantes";

export type Recinto = { nombre: string; alto: number; largo: number; ancho: number };

export type Cubicacion = {
  ml: number; // perímetro
  muroBruto: number;
  muroNeto: number; // descuenta vanos
  pano: number; // un muro neto: paño continuo a pintar
  cielo: number;
  piso: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mismas fórmulas que la hoja "Calculo de Area" de la planilla emitida. */
export function cubicar({ alto, largo, ancho }: Omit<Recinto, "nombre">): Cubicacion {
  const muroBruto = 2 * (alto * largo) + 2 * (alto * ancho);
  const muroNeto = muroBruto * FACTOR_VANOS;
  return {
    ml: r2(2 * largo + 2 * ancho),
    muroBruto: r2(muroBruto),
    muroNeto: r2(muroNeto),
    pano: r2(muroNeto / 4),
    cielo: r2(largo * ancho),
    piso: r2(largo * ancho),
  };
}
