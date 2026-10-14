import type { Provision } from "./provision";

/** Lo que trae el borrador del informe (Word) del liquidador: los datos de portada que antes venían de la Provisión, más la denuncia y la fecha de emisión. */
export type DatosBorrador = Provision & {
  fechaInspeccion: string | null; // dd/mm/aaaa
  fechaEmision: string | null;
  denunciaTexto: string | null;
  ubicacion: string | null;
};

const UF = (s: string | null) => (s ? Number(s.replace(/\./g, "").replace(",", ".")) : null);

/**
 * Lee el texto plano del borrador (portada en tablas «etiqueta → valor», una celda por línea). Es tolerante: lo que no encuentra queda en null
 * y el informe lo marca como [FALTA DATO]; nunca se pide al usuario un documento extra para completarlo.
 */
export function parsearBorrador(texto: string): DatosBorrador {
  const lineas = texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[:.]$/, "").trim();
  const indice = (etiqueta: string, desde = 0, hasta = lineas.length) => {
    for (let i = desde; i < hasta; i++) if (norm(lineas[i]) === norm(etiqueta)) return i;
    return -1;
  };
  const valor = (etiqueta: string, desde = 0, hasta = lineas.length): string | null => {
    const i = indice(etiqueta, desde, hasta);
    return i >= 0 && i + 1 < hasta ? lineas[i + 1] : null;
  };
  const fecha = (s: string | null) => /^\d{2}[/-]\d{2}[/-]\d{4}$/.test(s ?? "") ? s!.replace(/-/g, "/") : null;

  const iBenef = indice("Del beneficiario");
  const iAseg = indice("Del asegurado");
  const iCuantia = indice("De la cuantía");
  const fin = (i: number, ...otros: number[]) => otros.filter((x) => x > i).sort((a, b) => a - b)[0] ?? lineas.length;
  const hastaBenef = iBenef >= 0 ? fin(iBenef, iAseg, iCuantia) : 0;
  const hastaAseg = iAseg >= 0 ? fin(iAseg, iCuantia, iBenef) : 0;

  const encabezado = lineas.find((l) => /Siniestro\s+\d+/.test(l) && l.includes("&")) ?? lineas.find((l) => /Siniestro\s+\d+/.test(l)) ?? "";
  const aseguradora = /&\s*(.+?)\s*Siniestro\s+\d+/.exec(encabezado)?.[1]?.trim() ?? null;

  const poliza = valor("Póliza");
  const pm = /^(.+?)\s+(\d+),\s*[ií]tem\s*(\d+)/i.exec(poliza ?? "");
  const iVig = indice("Vigencia");
  const vig = iVig >= 0 ? lineas.slice(iVig, iVig + 6).join(" ") : "";

  const iMateria = indice("Materia/Suma asegurada");
  let materia: string | null = null;
  let suma: number | null = null;
  if (iMateria >= 0) {
    materia = lineas[iMateria + 1] && norm(lineas[iMateria + 1]) !== "uf" ? lineas[iMateria + 1] : null;
    const iUf = lineas.findIndex((l, i) => i > iMateria && i < iMateria + 5 && norm(l) === "uf");
    suma = iUf >= 0 ? UF(lineas[iUf + 1] ?? null) : null;
  }
  const iDed = indice("Deducible");
  let deducible: number | null = null;
  if (iDed >= 0) deducible = norm(lineas[iDed + 1] ?? "") === "uf" ? UF(lineas[iDed + 2] ?? null) : 0; // «No se pactó aplicación» = sin deducible

  const iDen = lineas.findIndex((l) => /^Denuncia\s*En parte del texto|expresamente lo siguiente:?$/i.test(l));
  const persona = (desde: number, hasta: number) => ({
    nombre: desde >= 0 ? valor("Nombre", desde, hasta) : null,
    rut: desde >= 0 ? valor("RUT", desde, hasta) : null,
    direccion: desde >= 0 ? valor("Dirección", desde, hasta) : null,
  });

  return {
    liquidacion: /INFORME DE LIQUIDACI[ÓO]N\s*(\d+)/i.exec(lineas.join("\n"))?.[1] ?? null,
    siniestro: /Siniestro\s+(\d+)/.exec(encabezado)?.[1] ?? null,
    aseguradora,
    beneficiario: persona(iBenef, hastaBenef),
    asegurado: persona(iAseg, hastaAseg),
    polizaNumero: pm?.[2] ?? null,
    polizaItem: pm?.[3] ?? null,
    vigenciaDesde: fecha(/Desde las [\d:.]+ horas del ([\d/-]+)/.exec(vig)?.[1] ?? null),
    vigenciaHasta: fecha(/Hasta las [\d:.]+ horas del ([\d/-]+)/.exec(vig)?.[1] ?? null),
    materia,
    sumaAseguradaUF: suma,
    deducibleUF: deducible,
    fechaOcurrencia: fecha(valor("Fecha ocurrencia")),
    fechaDenuncia: fecha(valor("Fecha denuncia")),
    fechaAsignacion: fecha(valor("Fecha asignación")),
    fechaInspeccion: fecha(valor("Fecha inspección")),
    fechaEmision: fecha(valor("Fecha emisión de informe")),
    denunciaTexto: iDen >= 0 && !/^(Contrato de seguros|DILIGENCIAS)/i.test(lineas[iDen + 1] ?? "") ? (lineas[iDen + 1] ?? null) : null,
    ubicacion: valor("Ubicación"),
  };
}
