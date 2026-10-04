import { emitir } from "../traza";
import { datosCasoSchema, type DatosCaso } from "../domain/tipos";
import { hashReclamacion } from "../engine/hash";
import { parsearActa, type ActaInspeccion } from "../extraccion/acta";
import { esEscaneado, textoPdf } from "../extraccion/pdf";
import { parsearPresupuestoPdf, parsearPresupuestoXlsx, type ResultadoPresupuesto } from "../extraccion/presupuesto";
import { parsearProvision, type Provision } from "../extraccion/provision";
import {
  actualizarCaso,
  archivosConContenido,
  guardarExtraccion,
  guardarReclamacion,
  obtenerCaso,
  type Caso,
} from "./repositorio";

const dmy = (s: string | null | undefined) => (s ? s.replace(/-/g, "/") : "");
const iso = (s: string | null | undefined) => (s ? s.replace(/\//g, "-").split("-").reverse().join("-") : "");

/** UF del día del siniestro (API pública mindicador.cl). Si no responde, el caso queda con alerta, nunca con un valor inventado. */
export async function valorUF(fechaIso: string): Promise<number | null> {
  const [a, m, d] = fechaIso.split("-");
  const base = process.env.UF_API_URL ?? "https://mindicador.cl/api/uf";
  try {
    const r = await fetch(`${base}/${d}-${m}-${a}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { serie?: { valor: number }[] };
    return j.serie?.[0]?.valor ?? null;
  } catch {
    return null;
  }
}

export const SOSPECHA_TILDES = /\b(Munoz|Nunez|Perez|Gonzalez|Hernandez|Martinez|Cardenas|Andres|Elias|Jose|Maria|Concepcion|Huerfanos|Nunoa|Ibanez|Sepulveda)\b/;

export function construirDatosCaso(
  acta: ActaInspeccion | null,
  prov: Provision | null,
  previos: Caso["datos"],
  hayPresupuesto: boolean,
): { datos: DatosCaso; alertas: string[] } {
  const alertas: string[] = [];
  const falta = (campo: string, v: string | null | undefined) => {
    if (!v) alertas.push(`Falta ${campo}: complétalo en la pestaña «Datos».`);
    return v ?? "";
  };
  const ocurrencia = iso(acta?.fechaSiniestro) || iso(prov?.fechaOcurrencia);
  const direccion = acta?.direccionRiesgo ?? prov?.asegurado.direccion ?? "";
  const ubicacion = [direccion, acta?.comuna, acta?.region].filter(Boolean).join(", ");
  const nombre = prov?.asegurado.nombre ?? acta?.asegurado ?? "";
  if (SOSPECHA_TILDES.test(`${nombre} ${ubicacion}`))
    alertas.push("Los PDF fuente no traen tildes ni ñ: revisa el nombre del asegurado y la dirección antes de emitir.");

  const datos: DatosCaso = datosCasoSchema.parse({
    siniestro: falta("n.º de siniestro", prov?.siniestro ?? acta?.siniestro),
    liquidacion: falta("n.º de liquidación", prov?.liquidacion ?? acta?.caso),
    aseguradora: acta?.compania?.replace(/\.$/, "") ?? prov?.aseguradora?.replace(/\.$/, "") ?? "HDI Seguros S.A",
    asegurado: {
      nombre: falta("nombre del asegurado", nombre),
      rut: falta("RUT del asegurado", prov?.asegurado.rut ?? acta?.rut),
      direccion: ubicacion,
    },
    beneficiario: {
      nombre: prov?.beneficiario.nombre ?? "Banco del Estado de Chile S.A.",
      rut: prov?.beneficiario.rut ?? "97.030.000-7",
      direccion: prov?.beneficiario.direccion ?? "Av. Libertador Bernardo O’Higgins 1111, Santiago",
    },
    poliza: {
      tipo: "Incendio",
      numero: falta("n.º de póliza", prov?.polizaNumero),
      item: falta("ítem de la póliza", prov?.polizaItem),
      vigenciaDesde: falta("inicio de vigencia", prov?.vigenciaDesde),
      vigenciaHasta: falta("fin de vigencia", prov?.vigenciaHasta),
      materia: prov?.materia ?? "Edificio casa habitacional",
      sumaAseguradaUF: prov?.sumaAseguradaUF ?? 0,
      deducibleUF: prov?.deducibleUF ?? 0,
    },
    ubicacion: falta("ubicación del riesgo", ubicacion),
    comuna: acta?.comuna ?? "",
    region: acta?.region ?? "",
    fechas: {
      inspeccion: dmy(acta?.fechaInspeccion),
      asignacion: prov?.fechaAsignacion ?? "",
      denuncia: prov?.fechaDenuncia ?? "",
      ocurrencia: falta("fecha de ocurrencia", ocurrencia),
      emision: previos.fechas?.emision ?? null,
      informadoPartes: previos.fechas?.informadoPartes ?? null,
    },
    denunciaTexto: previos.denunciaTexto ?? null,
    modo: hayPresupuesto ? "reclamacion" : "perdida_determinada",
  });
  if (!prov?.sumaAseguradaUF) alertas.push("No se leyó la suma asegurada de la Provisión.");
  if (!datos.fechas.asignacion || !datos.fechas.denuncia) alertas.push("Faltan las fechas de asignación o denuncia (vienen de la Provisión).");
  return { datos, alertas };
}

export type InformeProceso = { alertas: string[]; archivosLeidos: string[]; presupuesto: ResultadoPresupuesto | null };

/** Lee todos los documentos del caso, guarda lo extraído y deja el caso listo para ajustar. */
export async function procesarCaso(casoId: string, usuarioId: string): Promise<InformeProceso> {
  const caso = await obtenerCaso(casoId, usuarioId);
  if (!caso) throw new Error("Caso no encontrado");
  const alertas: string[] = [];
  const leidos: string[] = [];
  emitir("info", "documentos", "Buscando los documentos cargados en el caso");

  let acta: ActaInspeccion | null = null;
  const actas = await archivosConContenido(casoId, "acta");
  if (actas[0]) {
    const pag = await textoPdf(actas[0].contenido);
    emitir("info", "acta", `Acta «${actas[0].nombre}»: ${pag.length} páginas con ${pag.reduce((t, x) => t + x.length, 0)} caracteres de texto`);
    if (esEscaneado(pag)) alertas.push("El acta está escaneada (sin texto): no se pudo leer. Sube la versión original en PDF.");
    else {
      acta = parsearActa(pag);
      leidos.push(actas[0].nombre);
      emitir("ok", "acta", `Acta leída: siniestro ${acta.siniestro ?? "?"}, ${acta.danos.length} recinto(s) dañado(s), ${acta.hechos?.length ?? 0} caracteres de hechos`);
      if (acta.danos.length === 0) alertas.push("No se encontraron recintos dañados en el acta.");
    }
  } else alertas.push("Falta el Acta de inspección.");

  let prov: Provision | null = null;
  const provs = await archivosConContenido(casoId, "provision");
  if (provs[0]) {
    prov = parsearProvision(await textoPdf(provs[0].contenido));
    emitir("ok", "provision", `Provisión leída: liquidación ${prov.liquidacion ?? "?"}, siniestro ${prov.siniestro ?? "?"}`);
    leidos.push(provs[0].nombre);
  } else alertas.push("Falta la Provisión de pérdida (datos de póliza, vigencia y suma asegurada).");

  let presupuesto: ResultadoPresupuesto | null = null;
  const xl = await archivosConContenido(casoId, "presupuesto_xlsx");
  const pd = await archivosConContenido(casoId, "presupuesto_pdf");
  if (xl[0]) {
    presupuesto = await parsearPresupuestoXlsx(xl[0].contenido);
    emitir("ok", "presupuesto", `Presupuesto Excel leído: ${presupuesto.reclamacion.lineas.length} partidas`);
    leidos.push(xl[0].nombre);
  } else if (pd[0]) {
    const pag = await textoPdf(pd[0].contenido);
    if (esEscaneado(pag)) alertas.push("El presupuesto en PDF está escaneado: se requiere el original con texto.");
    else {
      presupuesto = parsearPresupuestoPdf(pag);
      emitir("ok", "presupuesto", `Presupuesto PDF leído: ${presupuesto.reclamacion.lineas.length} partidas`);
      leidos.push(pd[0].nombre);
    }
  }
  if (presupuesto) {
    alertas.push(...presupuesto.alertas.map((a) => `Presupuesto: ${a}`));
    if (presupuesto.reclamacion.lineas.length) await guardarReclamacion(casoId, presupuesto.reclamacion, hashReclamacion(presupuesto.reclamacion));
    else presupuesto = null;
  }

  const { datos, alertas: aDatos } = construirDatosCaso(acta, prov, caso.datos, presupuesto != null);
  alertas.push(...aDatos);
  if (acta) await guardarExtraccion(casoId, "acta", acta);
  if (prov) await guardarExtraccion(casoId, "provision", prov);

  emitir("info", "uf", `Consultando el valor de la UF del ${datos.fechas.ocurrencia || "(fecha sin definir)"} en mindicador.cl`);
  const uf = datos.fechas.ocurrencia ? await valorUF(datos.fechas.ocurrencia) : null;
  if (uf == null) alertas.push("No se pudo obtener la UF de la fecha del siniestro: ingrésala a mano en «Datos».");

  emitir(uf == null ? "error" : "ok", "uf", uf == null ? "No se obtuvo la UF" : `UF de la fecha: ${uf}`);
  emitir("ok", "documentos", `Lectura terminada: ${leidos.length} documento(s) leído(s), ${alertas.length} aviso(s)`);
  await actualizarCaso(casoId, {
    siniestro: datos.siniestro || caso.siniestro,
    modo: datos.modo,
    datos: { ...datos, alertas },
    valor_uf: uf ?? caso.valor_uf,
    estado: "extraido",
  });
  return { alertas, archivosLeidos: leidos, presupuesto };
}
