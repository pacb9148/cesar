/** Parser determinista del Acta de Inspección (formato fijo de Beckett). Sin IA: lo que se lee, se lee. */

export type DanoActa = {
  recinto: string;
  alto: number;
  ancho: number;
  largo: number;
  descripcion: string;
  tipoDano: string;
  um: string;
  cantidad: number;
};

export type ActaInspeccion = {
  siniestro: string | null;
  caso: string | null;
  compania: string | null;
  asegurado: string | null;
  rut: string | null;
  direccionRiesgo: string | null;
  comuna: string | null;
  region: string | null;
  fechaSiniestro: string | null; // dd-mm-aaaa
  fechaInspeccion: string | null;
  inspector: string | null;
  hechos: string | null;
  pisos: number | null;
  dormitorios: number | null;
  banos: number | null;
  superficieM2: number | null;
  antiguedad: number | null;
  sistemaEstructural: string | null;
  estructuraTechumbre: string | null;
  cubierta: string | null;
  pavimentos: string | null;
  danosEdificio: boolean | null;
  danosContenido: boolean | null;
  danos: DanoActa[];
};

const n = (s: string | undefined) => (s == null ? null : Number(s.replace(",", ".")));
const campo = (t: string, re: RegExp) => re.exec(t)?.[1]?.trim() || null;
const limpiar = (s: string | null) => (s && s !== "-" ? s.replace(/\s+/g, " ").trim() : null);

const TIPOS = /\b(Afectado por agua|Afectado por|Manchado|Roto|Reparado|Fisurado|Desprendido|Oxidado)\b/gi;
const NUM = /^\d+(?:[.,]\d+)?$/;

/** Inicio de fila: "Nombre [n] alto ancho largo descripción…". Los 3 últimos números seguidos son las medidas. */
function FILA_INICIO_EXEC(linea: string): [string, string, string, string, string, string] | null {
  const tk = linea.trim().split(/\s+/);
  const i = tk.findIndex((x, k) => k > 0 && NUM.test(x));
  if (i < 1) return null;
  let j = i;
  while (j < tk.length && NUM.test(tk[j])) j++;
  const corrida = j - i;
  if (corrida < 3) return null;
  const finDims = j;
  const nombre = tk.slice(0, finDims - 3).join(" ");
  const [a, b, c] = tk.slice(finDims - 3, finDims);
  return [linea, nombre, a, b, c, tk.slice(finDims).join(" ")];
}
const FILA_INICIO = { exec: FILA_INICIO_EXEC };
const CIERRE = /(?:^|\s)(m2|ml|un|gl)\s+(\d+(?:[.,]\d+)?)\s*$/i;

export function parsearActa(paginas: string[]): ActaInspeccion {
  const t = paginas.join("\n");
  const plano = t.replace(/\n/g, " ").replace(/\s+/g, " ");

  const secDanos = /VI\.\s*DA[ÑN]OS Y PERJUICIOS([\s\S]*?)(?:VII\.|VIII\.|Croquis|$)/.exec(t)?.[1] ?? "";
  const lineas = secDanos
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^Edificio \/ Instalaciones$/i.test(l) && !/^Dependencia Alto Ancho/i.test(l) && !/^P[áa]gina:/i.test(l));

  const danos: DanoActa[] = [];
  let actual: { recinto: string; alto: number; ancho: number; largo: number; texto: string[] } | null = null;
  for (const l of lineas) {
    const inicio: ReturnType<typeof FILA_INICIO_EXEC> = !actual ? FILA_INICIO.exec(l) : null;
    const nueva: ReturnType<typeof FILA_INICIO_EXEC> = actual && CIERRE.test(actual.texto.join(" ")) ? FILA_INICIO.exec(l) : null;
    const m: ReturnType<typeof FILA_INICIO_EXEC> = inicio ?? nueva;
    if (m) {
      actual = { recinto: m[1].trim(), alto: n(m[2])!, ancho: n(m[3])!, largo: n(m[4])!, texto: [] };
      if (m[5]) actual.texto.push(m[5]);
    } else if (actual) actual.texto.push(l);
    if (actual) {
      const unido = actual.texto.join(" ");
      const c = CIERRE.exec(unido);
      if (c) {
        const sinCierre = unido.slice(0, c.index).trim();
        const tipos = [...sinCierre.matchAll(TIPOS)].map((x) => x[0]);
        // "Afectado por" siempre continúa con "agua" en el formato del acta, aunque el PDF la separe.
        const tipo = tipos.some((x) => /^afectado por/i.test(x)) ? "Afectado por agua" : (tipos[tipos.length - 1] ?? "");
        const desc = sinCierre.replace(TIPOS, "").replace(/\s+/g, " ").replace(/\s+agua$/i, "").trim();
        danos.push({
          recinto: actual.recinto,
          alto: actual.alto,
          ancho: actual.ancho,
          largo: actual.largo,
          descripcion: desc,
          tipoDano: tipo,
          um: c[1].toLowerCase(),
          cantidad: n(c[2])!,
        });
        actual = null;
      }
    }
  }

  const hechos = /II\.\s*DE LOS HECHOS\s*([\s\S]*?)\s*III\./.exec(t)?.[1];
  return {
    siniestro: campo(plano, /Siniestro N°\s*(\d+)/),
    caso: campo(plano, /Caso N°:\s*(\d+)/),
    compania: campo(plano, /Compa[ñn]ia:\s*(.+?)\s+Asegurado:/),
    asegurado: campo(plano, /Asegurado:\s*(.+?)\s+RUT:/),
    rut: campo(plano, /RUT:\s*([\dkK.\-]+)/),
    direccionRiesgo: campo(plano, /Direcci[óo]n del riesgo:\s*(.+?)\s+Comuna:/),
    comuna: campo(plano, /Comuna:\s*(.+?)\s+Regi[óo]n:/),
    region: campo(plano, /Regi[óo]n:\s*(Regi[óo]n .+?)\s+Fono:/),
    fechaSiniestro: campo(plano, /Fecha siniestro:\s*([\d-]+)/),
    fechaInspeccion: campo(plano, /Fecha inspecci[óo]n:\s*([\d-]+)/),
    inspector: campo(plano, /Realizada por:\s*(.+?)\s+II\./),
    hechos: hechos ? hechos.replace(/\s+/g, " ").trim() : null,
    pisos: n(campo(plano, /N° de pisos:\s*(\d+)/) ?? undefined),
    dormitorios: n(campo(plano, /N° de dormitorios:\s*(\d+)/) ?? undefined),
    banos: n(campo(plano, /N° de ba[ñn]os:\s*(\d+)/) ?? undefined),
    superficieM2: n(campo(plano, /Superficie construida\s*([\d.,]+)\s*m2/) ?? undefined),
    antiguedad: n(campo(plano, /Antig[üu]edad:\s*(\d+)/) ?? undefined),
    sistemaEstructural: limpiar(campo(plano, /Sistema estructural:\s*(.*?)\s+Estructura techumbre:/)),
    estructuraTechumbre: limpiar(campo(plano, /Estructura techumbre:\s*(.*?)\s+Cubierta:/)),
    cubierta: limpiar(campo(plano, /Cubierta:\s*(.*?)\s+Pavimentos:/)),
    pavimentos: limpiar(campo(plano, /Pavimentos:\s*(.*?)\s+V\.\s*INSTRUCCIONES/)),
    danosEdificio: /Da[ñn]os en EDIFICIO:\s*Si/i.test(plano) ? true : /Da[ñn]os en EDIFICIO:\s*No/i.test(plano) ? false : null,
    danosContenido: /Da[ñn]os en CONTENIDO:\s*Si/i.test(plano) ? true : /Da[ñn]os en CONTENIDO:\s*No/i.test(plano) ? false : null,
    danos,
  };
}
