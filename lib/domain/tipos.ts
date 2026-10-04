import { z } from "zod";
import { LETRAS_OBS } from "./constantes";

export const unidadSchema = z.enum(["m2", "ml", "gl", "un", "m3", "kg"]);
export type Unidad = z.infer<typeof unidadSchema>;

/** Una línea de la reclamación del contratista, transcrita sin tocar. */
export const lineaReclamacionSchema = z.object({
  item: z.string(), // "3.1"
  recinto: z.string(), // sección a la que pertenece, p. ej. "LIVING"
  descripcion: z.string(),
  um: unidadSchema,
  cantidad: z.number(),
  pu: z.number(),
});
export type LineaReclamacion = z.infer<typeof lineaReclamacionSchema>;

export const seccionSchema = z.object({ numero: z.string(), titulo: z.string() });
export type Seccion = z.infer<typeof seccionSchema>;

export const reclamacionSchema = z.object({
  secciones: z.array(seccionSchema),
  lineas: z.array(lineaReclamacionSchema),
  /** Total directo que el contratista declara en su presupuesto; sirve de control cruzado. */
  totalDirectoDeclarado: z.number().nullable(),
  ggPct: z.number(), // gastos generales (o GG + utilidades si es unificado)
  utilidadPct: z.number(), // 0 si es unificado
  ivaPct: z.number(),
});
export type Reclamacion = z.infer<typeof reclamacionSchema>;

export const origenPrecioSchema = z.string().regex(/^(baremo:\d+|mercado:.+|reclamacion)$/);

const lineaAjusteBase = {
  um: unidadSchema,
  cantidad: z.number().min(0),
  pu: z.number().positive(),
  pu_origen: origenPrecioSchema,
  obs: z.array(z.enum(LETRAS_OBS)).min(1),
  justificacion: z.string().min(3),
};

export const sublineaSchema = z.object({ descripcion: z.string(), ...lineaAjusteBase });
export type Sublinea = z.infer<typeof sublineaSchema>;

export const decisionLineaSchema = z.object({
  item: z.string(),
  accion: z.enum(["ajustar", "desglosar", "respetar"]),
  // Una línea "desglosar" queda en blanco en Ajuste y su detalle va en sublineas.
  um: unidadSchema.nullable(),
  cantidad: z.number().min(0).nullable(),
  pu: z.number().positive().nullable(),
  pu_origen: origenPrecioSchema.nullable(),
  obs: z.array(z.enum(LETRAS_OBS)),
  justificacion: z.string(),
  sublineas: z.array(sublineaSchema),
  // Quién tocó la partida por última vez: "usuario" la marca en verde en pantalla. Sin valor: la decidió el sistema.
  fuente: z.enum(["usuario"]).optional(),
});
export type DecisionLinea = z.infer<typeof decisionLineaSchema>;

/** Partida propia del perito: daño visto en la inspección que el contratista no cobró. Sin columna de Reclamación. */
export const lineaAdicionalSchema = z.object({
  seccion: z.string(), // recinto o sección donde se agrega
  descripcion: z.string(),
  um: unidadSchema,
  cantidad: z.number().min(0),
  pu: z.number().positive(),
  pu_origen: origenPrecioSchema,
  obs: z.array(z.enum(LETRAS_OBS)),
  justificacion: z.string().min(3),
});
export type LineaAdicional = z.infer<typeof lineaAdicionalSchema>;

export const estadoDatoSchema = z.enum(["extraido", "deducido", "faltante"]);
export const datoSchema = z.object({
  valor: z.union([z.string(), z.number()]).nullable(),
  estado: estadoDatoSchema,
  evidencia: z.array(z.string()),
});
export type Dato = z.infer<typeof datoSchema>;

export const CLAVES_CARACTERISTICAS = [
  "pisos",
  "superficie_m2",
  "antiguedad_anios",
  "dormitorios",
  "banos",
  "sistema_estructural",
  "techumbre",
  "cubierta",
  "pavimentos",
] as const;
export type ClaveCaracteristica = (typeof CLAVES_CARACTERISTICAS)[number];

export const evidenciaRecintoSchema = z.object({
  recinto: z.string(),
  vineta: z.string(),
  m2_acta: z.number().nullable(),
  atribuible: z.boolean(),
  fotos: z.array(z.string()),
});
export type EvidenciaRecinto = z.infer<typeof evidenciaRecintoSchema>;

export const salidaAgenteSchema = z.object({
  caracteristicas: z.object(
    Object.fromEntries(CLAVES_CARACTERISTICAS.map((k) => [k, datoSchema])) as Record<
      ClaveCaracteristica,
      typeof datoSchema
    >,
  ),
  evidencia_observada: z.array(evidenciaRecintoSchema),
  lineas: z.array(decisionLineaSchema),
  lineas_adicionales: z.array(lineaAdicionalSchema),
  ajuste_de_perdida_texto: z.string(),
  resumen_ajuste: z.array(z.string()).min(3).max(4),
  faltantes: z.array(z.object({ campo: z.string(), motivo: z.string() })),
});
export type SalidaAgente = z.infer<typeof salidaAgenteSchema>;

/** Datos administrativos del siniestro (portada del informe). */
export const datosCasoSchema = z.object({
  siniestro: z.string(),
  liquidacion: z.string(),
  aseguradora: z.string(),
  asegurado: z.object({ nombre: z.string(), rut: z.string(), direccion: z.string() }),
  beneficiario: z.object({ nombre: z.string(), rut: z.string(), direccion: z.string() }),
  poliza: z.object({
    tipo: z.string(),
    numero: z.string(),
    item: z.string(),
    vigenciaDesde: z.string(),
    vigenciaHasta: z.string(),
    materia: z.string(),
    sumaAseguradaUF: z.number(),
    deducibleUF: z.number(),
  }),
  ubicacion: z.string(),
  comuna: z.string(),
  region: z.string(),
  fechas: z.object({
    inspeccion: z.string(),
    asignacion: z.string(),
    denuncia: z.string(),
    ocurrencia: z.string(), // ISO yyyy-mm-dd
    emision: z.string().nullable(),
    informadoPartes: z.string().nullable(),
  }),
  denunciaTexto: z.string().nullable(),
  modo: z.enum(["reclamacion", "perdida_determinada"]),
});
export type DatosCaso = z.infer<typeof datosCasoSchema>;
