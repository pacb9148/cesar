/** Única fuente de las constantes técnicas: UI, motor y validadores leen de aquí. */

export const PLANCHA_M2 = 2.88; // 1,2 × 2,4 m: mínimo técnico en yeso-cartón / OSB / terciado
export const CANTIDAD_PREVENTIVA = 1; // "Regla del 1"
export const FACTOR_VANOS = 0.7; // el muro neto descuenta 30 % de puertas y ventanas
export const IVA = 0.19;
export const GG_UTILIDADES_UNIFICADO = 0.25;

export const LETRAS_OBS = ["A", "B", "C", "D", "E", "F"] as const;
export type LetraObs = (typeof LETRAS_OBS)[number];

/** Leyenda exacta pedida por el dueño; se escribe tal cual en el Excel y en el cuadro de pérdida. */
export const LEYENDA: Record<LetraObs, string> = {
  A: "Daños por mantenimiento, oxidación y deterioro progresivo.",
  B: 'Precio unitario ajustado luego de consultar con proveedores de la región / baremo oficial a todo costo.',
  C: "Cantidad de trabajo o material ajustada a la medición exacta del acta o al mínimo técnico constructivo (Ej: m² a ml, o unidades a m² instalados).",
  D: "No se registran daños atribuibles al siniestro en esta magnitud (Ajuste a mínimo preventivo).",
  E: 'Actividad incluida como gastos generales o absorbida en partidas a "Todo Costo".',
  F: "Se respeta valor o cantidad reclamada por estar acorde a mercado o declaración original.",
};

export const MARCADOR_FALTA_DATO = "[FALTA DATO: Rellenar con XXX]";

export const FRASES_PROHIBIDAS = [
  "se presume",
  "no se especifica",
  "no hay información",
  "no hay informacion",
  "se supone",
];

/** Cantidad 0 solo es válida con estas letras (daño ajeno al evento o actividad absorbida). */
export const LETRAS_CANTIDAD_CERO: readonly LetraObs[] = ["A", "D", "E"];

/** Fotografías del informe y del anexo: tamaño fijo de cada imagen y cuadrícula de 2 columnas × 3 filas por tabla. */
export const FOTO_ANCHO_CM = 7.8;
export const FOTO_ALTO_CM = 6.5;
export const FOTOS_COLUMNAS = 2;
export const FOTOS_FILAS = 3;
export const FOTOS_POR_TABLA = FOTOS_COLUMNAS * FOTOS_FILAS;
/** Máximo de fotos por recinto en el informe: las más relevantes del área afectada; el anexo lleva todas. */
export const FOTOS_MAX_POR_RECINTO_INFORME = 4;
export const LEYENDA_FOTO_MAX = 46; // caracteres: una sola línea bajo una imagen de 7,8 cm
