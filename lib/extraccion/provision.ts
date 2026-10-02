/** Parser determinista de la Provisión de pérdida (datos administrativos de la portada). */

export type Provision = {
  liquidacion: string | null;
  siniestro: string | null;
  aseguradora: string | null;
  beneficiario: { nombre: string | null; rut: string | null; direccion: string | null };
  asegurado: { nombre: string | null; rut: string | null; direccion: string | null };
  polizaNumero: string | null;
  polizaItem: string | null;
  vigenciaDesde: string | null; // dd/mm/aaaa
  vigenciaHasta: string | null;
  materia: string | null;
  sumaAseguradaUF: number | null;
  deducibleUF: number | null;
  fechaOcurrencia: string | null; // dd/mm/aaaa
  fechaDenuncia: string | null;
  fechaAsignacion: string | null;
};

const ufNum = (s: string | null) => (s ? Number(s.replace(/\./g, "").replace(",", ".")) : null);
const campo = (t: string, re: RegExp) => re.exec(t)?.[1]?.trim() ?? null;
const dmy = (s: string | null) => (s ? s.replace(/-/g, "/") : null);

export function parsearProvision(paginas: string[]): Provision {
  const t = paginas.join("\n").replace(/[ \t]+/g, " ");
  const plano = t.replace(/\n/g, " ").replace(/\s+/g, " ");
  const bloque = (desde: RegExp, hasta: RegExp) => {
    const a = desde.exec(plano);
    if (!a) return "";
    const resto = plano.slice(a.index);
    const b = hasta.exec(resto.slice(a[0].length));
    return b ? resto.slice(0, a[0].length + b.index) : resto;
  };
  const benef = bloque(/Beneficiario\s/, /Asegurado\s/);
  const aseg = bloque(/Asegurado\s/, /Actividad|Intermediario/);
  return {
    liquidacion: campo(plano, /LIQUIDACI[ÓO]N N[º°o]\s*(\d+)/i),
    siniestro: campo(plano, /SINIESTRO N°\s*(\d+)/i),
    aseguradora: campo(plano, /\bA (HDI Seguros S\.A\.?)/),
    beneficiario: {
      nombre: campo(benef, /Beneficiario\s+(.+?)\s+RUT/),
      rut: campo(benef, /RUT\s*(?:N°)?\s*([\dkK.\-]+)/),
      direccion: campo(benef, /Direcci[óo]n\s+(.+?)(?:\s+Asegurado|$)/),
    },
    asegurado: {
      nombre: campo(aseg, /Asegurado\s+(.+?)\s+RUT/),
      rut: campo(aseg, /RUT\s*(?:N°)?\s*([\dkK.\-]+)/),
      direccion: campo(aseg, /Direcci[óo]n\s+(.+?)$/),
    },
    polizaNumero: campo(plano, /P[óo]liza de .*? N°\s*(\d+)/),
    polizaItem: campo(plano, /[ÍI]tem N°\s*(\d+)/i),
    vigenciaDesde: dmy(campo(plano, /Desde las [\d:]+ horas del ([\d/-]+)/)),
    vigenciaHasta: dmy(campo(plano, /Hasta las [\d:]+ horas del ([\d/-]+)/)),
    materia: campo(plano, /Monto\/materia asegurada\s+(.+?)\s+UF\s*[\d.,]+/),
    sumaAseguradaUF: ufNum(campo(plano, /Monto\/materia asegurada\s+.+?\s+UF\s*([\d.,]+)/)),
    deducibleUF: ufNum(campo(plano, /Deducible\s+.+?\s+UF\s*([\d.,]+)/)),
    fechaOcurrencia: dmy(campo(plano, /Fecha ocurrencia\s+([\d/-]+)/)),
    fechaDenuncia: dmy(campo(plano, /Fecha denuncia\s+([\d/-]+)/)),
    fechaAsignacion: dmy(campo(plano, /Fecha asignaci[óo]n\s+([\d/-]+)/)),
  };
}
