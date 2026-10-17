import { CLAVES_CARACTERISTICAS, type SalidaAgente } from "../domain/tipos";
import type { ActaInspeccion } from "../extraccion/acta";
import { caracteristicasDelActa } from "../ia/agente";
import { vinetaDeDano } from "./parrafo-inmueble";
import { partidasDeEvidencia } from "./partidas-evidencia";

/**
 * Ajuste de partida: todas las partidas del presupuesto aceptadas tal como se reclamaron («sin ajustar»), listo para que el liquidador
 * ajuste a mano lo que corresponda o para que la IA lo mejore. Permite avanzar hasta el informe sin depender de ningún proveedor de IA.
 */
export function salidaBase(acta: ActaInspeccion | null, opciones: { conPartidas?: boolean } = {}): SalidaAgente {
  const caracteristicas = acta
    ? caracteristicasDelActa(acta)
    : (Object.fromEntries(CLAVES_CARACTERISTICAS.map((k) => [k, { valor: null, estado: "faltante" as const, evidencia: [] }])) as unknown as SalidaAgente["caracteristicas"]);
  return {
    caracteristicas,
    evidencia_observada: (acta?.danos ?? []).map((x) => ({
      recinto: x.recinto,
      vineta: vinetaDeDano(x),
      m2_acta: x.cantidad ?? null,
      atribuible: true,
      fotos: [],
    })),
    lineas: [],
    // Sin presupuesto del contratista: plantilla base con las partidas que salen de la evidencia de la inspección (el usuario las edita y agrega las que falten).
    lineas_adicionales: opciones.conPartidas && acta ? partidasDeEvidencia(acta).partidas : [],
    ajuste_de_perdida_texto:
      "Las partidas del presupuesto se contrastaron con la medición del acta de inspección. Las que no fueron ajustadas se respetan según lo reclamado por el contratista, por estar acordes a mercado y a la declaración original; los ajustes realizados por el liquidador se indican con su letra de observación.",
    resumen_ajuste: [
      "Se revisó el presupuesto del contratista contra el acta de inspección.",
      "Las partidas sin ajuste se respetan según lo reclamado (letra F).",
      "Los ajustes del liquidador se señalan con su letra de observación (A–F).",
    ],
    faltantes: Object.entries(caracteristicas).filter(([, v]) => v.estado === "faltante").map(([k]) => ({ campo: k, motivo: "No consta en el acta de inspección." })),
  };
}
