import { emitir } from "../traza";
import { datosCasoSchema, type DatosCaso } from "../domain/tipos";
import { hashReclamacion } from "../engine/hash";
import type { ActaInspeccion } from "../extraccion/acta";
import { textoPdf } from "../extraccion/pdf";
import type { ResultadoPresupuesto } from "../extraccion/presupuesto";
import type { ActaConExtras } from "../extraccion/ia-documentos";
import type { Fuente } from "../extraccion/universal";
import { leerInspeccion, leerPresupuesto } from "./leer-documentos";
import { ClienteConRespaldo } from "../ia/rotacion";
import { RegistroDb } from "../ia/repo-proveedores";
import mammoth from "mammoth";
import { consulta } from "../db";
import { clasificarArchivo } from "./clasificar";
import { parsearBorrador, type DatosBorrador } from "../extraccion/borrador";
import { parsearProvision, type Provision } from "../extraccion/provision";
import {
  actualizarCaso,
  archivosConContenido,
  guardarExtraccion,
  guardarReclamacion,
  casoConSiniestro,
  obtenerCaso,
  type Caso,
} from "./repositorio";

const dmy = (s: string | null | undefined) => (s ? s.replace(/-/g, "/") : "");
const iso = (s: string | null | undefined) => (s ? s.replace(/\//g, "-").split("-").reverse().join("-") : "");

/**
 * UF del día del siniestro (API pública mindicador.cl). Ese servicio es lento y a veces no responde: se reintenta con tiempos largos
 * (una respuesta tardó 14 s). Si no responde, el caso queda con alerta, nunca con un valor inventado.
 */
export async function valorUF(fechaIso: string, intentos = 3, esperaMs = 30_000): Promise<number | null> {
  const [a, m, d] = fechaIso.split("-");
  const base = process.env.UF_API_URL ?? "https://mindicador.cl/api/uf";
  for (let i = 1; i <= intentos; i++) {
    try {
      const r = await fetch(`${base}/${d}-${m}-${a}`, { signal: AbortSignal.timeout(esperaMs) });
      if (r.ok) {
        const j = (await r.json()) as { serie?: { valor: number }[] };
        const v = j.serie?.[0]?.valor;
        if (typeof v === "number" && v > 0) return v;
      }
    } catch {
      /* se reintenta */
    }
    if (i < intentos) emitir("info", "uf", `mindicador.cl no respondió (intento ${i} de ${intentos}); se reintenta`);
  }
  return null;
}

export const SOSPECHA_TILDES = /\b(Munoz|Nunez|Perez|Gonzalez|Hernandez|Martinez|Cardenas|Andres|Elias|Jose|Maria|Concepcion|Huerfanos|Nunoa|Ibanez|Sepulveda)\b/;

export function construirDatosCaso(
  acta: ActaInspeccion | null,
  prov: Provision | null,
  previos: Caso["datos"],
  hayPresupuesto: boolean,
  borr: DatosBorrador | null = null,
): { datos: DatosCaso; alertas: string[] } {
  const alertas: string[] = [];
  // Sin fecha en el borrador, el informe se emite y se informa a las partes hoy (el usuario puede corregirlas en «Datos»).
  const hoy = new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/-/g, "/");
  // Con solo acta, borrador y presupuesto, lo que no aparezca no se exige: el informe lo marca como [FALTA DATO] y se completa en «Datos» si hace falta.
  const falta = (_campo: string, v: string | null | undefined) => v ?? "";
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
      inspeccion: dmy(acta?.fechaInspeccion) || (borr?.fechaInspeccion ?? ""),
      asignacion: prov?.fechaAsignacion ?? "",
      denuncia: prov?.fechaDenuncia ?? "",
      ocurrencia: falta("fecha de ocurrencia", ocurrencia),
      emision: previos.fechas?.emision ?? borr?.fechaEmision ?? hoy,
      informadoPartes: previos.fechas?.informadoPartes ?? previos.fechas?.emision ?? borr?.fechaEmision ?? hoy,
    },
    denunciaTexto: previos.denunciaTexto ?? borr?.denunciaTexto ?? null,
    modo: hayPresupuesto ? "reclamacion" : "perdida_determinada",
  });
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

  // Inspección y presupuesto pueden venir en cualquier formato: lectura directa si se reconoce, IA (con visión) si no.
  const cliente = () => new ClienteConRespaldo(new RegistroDb(usuarioId), 3);
  const aFuentes = (l: { nombre: string; mime: string; contenido: Buffer }[]): Fuente[] => l.map((x) => ({ nombre: x.nombre, mime: x.mime, contenido: x.contenido }));
  let acta: ActaConExtras | null = null;
  const actas = await archivosConContenido(casoId, "acta");
  if (actas.length) {
    emitir("info", "acta", `Inspección: ${actas.map((a) => a.nombre).join(", ")}`);
    acta = await leerInspeccion(aFuentes(actas), cliente, alertas);
    if (acta) {
      leidos.push(...actas.map((a) => a.nombre));
      emitir("ok", "acta", `Inspección leída: siniestro ${acta.siniestro ?? "?"}, ${acta.danos.length} recinto(s) dañado(s), ${acta.hechos?.length ?? 0} caracteres de hechos`);
      if (acta.danos.length === 0) alertas.push("No se encontraron recintos dañados en la inspección.");
    }
  } else alertas.push("Falta el documento de inspección.");

  let prov: Provision | null = null;
  const provs = await archivosConContenido(casoId, "provision");
  if (provs[0]) {
    prov = parsearProvision(await textoPdf(provs[0].contenido));
    emitir("ok", "provision", `Provisión leída: liquidación ${prov.liquidacion ?? "?"}, siniestro ${prov.siniestro ?? "?"}`);
    leidos.push(provs[0].nombre);
  }

  // Los datos de portada salen del borrador del informe (Word); la Provisión, si alguien la sube, tiene prioridad pero ya no se exige.
  let borr: DatosBorrador | null = null;
  // Un archivo subido antes de que se reconociera su nombre quedó como «otro»: se reclasifica ahora; y un Word suelto cuyo texto es un informe
  // de liquidación (sea cual sea su nombre) también es el borrador.
  for (const a of await archivosConContenido(casoId, "otro")) {
    const t = clasificarArchivo(a.nombre, null, a.mime).tipo;
    if (t !== "otro") await consulta("update archivos set tipo = $2 where id = $1", [a.id, t]);
    else if (/.docx$/i.test(a.nombre) && /INFORME DE LIQUIDACI/i.test((await mammoth.extractRawText({ buffer: a.contenido }).catch(() => ({ value: "" }))).value)) await consulta("update archivos set tipo = 'borrador' where id = $1", [a.id]);
  }
  const borradores = await archivosConContenido(casoId, "borrador");
  if (borradores[0]) {
    borr = parsearBorrador((await mammoth.extractRawText({ buffer: borradores[0].contenido })).value);
    leidos.push(borradores[0].nombre);
    emitir("ok", "borrador", `Borrador leído: póliza ${borr.polizaNumero ?? "?"}, vigencia ${borr.vigenciaDesde ?? "?"} a ${borr.vigenciaHasta ?? "?"}, suma asegurada UF ${borr.sumaAseguradaUF ?? "?"}, ocurrencia ${borr.fechaOcurrencia ?? "?"}`);
    await guardarExtraccion(casoId, "borrador", borr);
  }

  let presupuesto: ResultadoPresupuesto | null = null;
  const docsPresupuesto = [...(await archivosConContenido(casoId, "presupuesto_xlsx")), ...(await archivosConContenido(casoId, "presupuesto_pdf")), ...(await archivosConContenido(casoId, "presupuesto_otro"))];
  if (docsPresupuesto.length) {
    presupuesto = await leerPresupuesto(aFuentes(docsPresupuesto), cliente, alertas);
    if (presupuesto) {
      leidos.push(...docsPresupuesto.map((d) => d.nombre));
      emitir("ok", "presupuesto", `Presupuesto leído: ${presupuesto.reclamacion.lineas.length} partidas`);
    }
  }
  if (presupuesto) {
    alertas.push(...presupuesto.alertas.map((a) => `Presupuesto: ${a}`));
    if (presupuesto.reclamacion.lineas.length) await guardarReclamacion(casoId, presupuesto.reclamacion, hashReclamacion(presupuesto.reclamacion));
    else presupuesto = null;
  }

  const { datos, alertas: aDatos } = construirDatosCaso(acta, prov ?? borr, caso.datos, presupuesto != null, borr);
  alertas.push(...aDatos);
  const repetido = datos.siniestro ? await casoConSiniestro(usuarioId, datos.siniestro, casoId) : null;
  if (repetido) alertas.push(`Ya existe otro caso con el siniestro ${datos.siniestro}: revisa si es el mismo y elimina el duplicado desde la lista de casos.`);
  if (acta) await guardarExtraccion(casoId, "acta", acta);
  if (prov) await guardarExtraccion(casoId, "provision", prov);

  emitir("info", "uf", `Consultando el valor de la UF del ${datos.fechas.ocurrencia || "(fecha sin definir)"} en mindicador.cl`);
  const uf = datos.fechas.ocurrencia ? await valorUF(datos.fechas.ocurrencia) : null;
  if (uf == null && !caso.valor_uf) alertas.push("No se pudo obtener la UF de la fecha del siniestro (el servicio mindicador.cl no respondió): vuelve a leer los documentos o ingrésala con «Agregar/Modificar UF» en el paso «Ajuste».");

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
