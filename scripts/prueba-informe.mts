// Prueba de punta a punta de los generadores con la planilla emitida del caso 1 como "salida del agente".
import { globSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { leerPlanilla } from "../lib/extraccion/planilla";
import { datosCasoSchema } from "../lib/domain/tipos";
import { generarExcel, type EntradaExcel } from "../lib/docs/excel";
import { cuadroPng, resumenCuadro } from "../lib/docs/cuadro";
import { generarInforme } from "../lib/docs/word";

const dir = globSync("fuente/1981023*")[0];
const orig = await leerPlanilla(join(dir, "1981023 Ajuste v1.xlsx"));
const caso = datosCasoSchema.parse({
  siniestro: "1981023",
  liquidacion: "170448",
  aseguradora: "HDI Seguros S.A.",
  asegurado: { nombre: "Juan Antonio Riquelme Muñoz", rut: "17.897.486-6", direccion: "Huérfanos 1751, Concepción" },
  beneficiario: { nombre: "Banco del Estado de Chile S.A.", rut: "97.030.000-7", direccion: "Av. Libertador Bernardo O’Higgins 1111, Santiago" },
  poliza: { tipo: "Incendio", numero: "20580183", item: "4", vigenciaDesde: "01/10/2024", vigenciaHasta: "30/09/2026", materia: "Edificio casa habitacional", sumaAseguradaUF: 1294, deducibleUF: 0 },
  ubicacion: "Huérfanos 1751, Concepción, Región del Biobío",
  comuna: "Concepción",
  region: "Región del Biobío",
  fechas: { inspeccion: "07/08/2026", asignacion: "29/07/2026", denuncia: "29/07/2026", ocurrencia: "2026-07-16", emision: "24/08/2026", informadoPartes: null },
  denunciaTexto: null,
  modo: "reclamacion",
});
const entrada: EntradaExcel = {
  caso,
  reclamacion: orig.reclamacion,
  decisiones: orig.decisiones,
  adicionales: orig.adicionales,
  valorUF: orig.valorUF!,
  recintos: [{ nombre: "Living", alto: 2.4, largo: 3.2, ancho: 3.2 }],
  siniestrosAnteriores: [],
};
const xlsx = await generarExcel(entrada);
writeFileSync("tmp/p-ajuste.xlsx", xlsx);
const png = await cuadroPng(entrada);
writeFileSync("tmp/p-cuadro.png", png);
const res = resumenCuadro(entrada);
console.log("UF rec/aj:", res.recUF.toFixed(2), res.ajUF.toFixed(2));

const fotos: { recinto: string; buffer: Buffer }[] = [];
const carpeta = globSync("fuente/1981023*/FOT*")[0];
for (const rc of readdirSync(carpeta)) {
  if (!statSync(join(carpeta, rc)).isDirectory()) continue;
  for (const f of readdirSync(join(carpeta, rc)).slice(0, 4)) fotos.push({ recinto: rc, buffer: readFileSync(join(carpeta, rc, f)) });
}
const dato = (valor: string | number | null) => ({ valor, estado: valor == null ? ("faltante" as const) : ("extraido" as const), evidencia: [] });
const informe = await generarInforme({
  caso,
  valorUF: entrada.valorUF,
  caracteristicas: {
    pisos: dato(2), superficie_m2: dato(70), antiguedad_anios: dato(null), dormitorios: dato(2), banos: dato(1),
    sistema_estructural: dato("albañilería"), techumbre: dato("cerchas de madera"), cubierta: dato("planchas de zinc alum y fibrocemento"), pavimentos: dato("cerámicas y alfombra"),
  },
  evidencia: [
    { recinto: "Cubierta general", vineta: "desanclaje de cubierta y levantamiento de hojalatería.", m2_acta: 50, atribuible: true, fotos: [] },
    { recinto: "Living", vineta: "cielo de madera machihembrada y muro de albañilería con manchas de aguas lluvias.", m2_acta: 22, atribuible: true, fotos: [] },
  ],
  ajusteTexto: "Sin perjuicio de la reclamación presentada, se revisó que los valores unitarios se ajustaran a precios de mercado y las cantidades a las cubicaciones efectuadas in situ por quienes suscriben.\nSe incluyen actividades como parte de los gastos generales.",
  totales: { reclamacionPesos: res.recTotalPesos, reclamacionUF: res.recUF, ajusteUF: res.ajUF, indemnizacionUF: res.indemnizacionUF },
  meteo: { estacion: "Carriel Sur, Concepción", precipitacionMm: 39.2, rafagaKmh: 110.5, imagenPng: null },
  cuadroPng: png,
  fotos,
  fachada: [],
  siniestrosAnteriores: false,
});
writeFileSync("tmp/p-informe.docx", informe);
console.log("informe bytes", informe.length);
