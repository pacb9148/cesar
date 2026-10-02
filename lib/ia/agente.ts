import { CANTIDAD_PREVENTIVA, PLANCHA_M2 } from "../domain/constantes";
import { salidaAgenteSchema, type Reclamacion, type SalidaAgente, CLAVES_CARACTERISTICAS, type Dato } from "../domain/tipos";
import type { ActaInspeccion } from "../extraccion/acta";
import { candidatos } from "../engine/baremo";
import { cubicar, type Cubicacion } from "../engine/cubicacion";
import { esquemaParaGemini, type ClienteLlm, type Parte } from "./gemini";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt";
import { validarSalida, type ResultadoValidacion } from "./validadores";

export type FotoModelo = { id: string; recinto: string; mime: string; base64: string };

export type EntradaAgente = {
  modo: "reclamacion" | "perdida_determinada";
  fechaSiniestro: string;
  valorUF: number;
  acta: ActaInspeccion;
  reclamacion: Reclamacion;
  fotos: FotoModelo[];
  preciosMercado: { fuente: string; descripcion: string; pu: number }[];
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Características que ya trae el acta. Un 0 o un campo vacío no es un dato: queda faltante. */
export function caracteristicasDelActa(a: ActaInspeccion): Record<(typeof CLAVES_CARACTERISTICAS)[number], Dato> {
  const ev = ["acta de inspección"];
  const d = (valor: string | number | null | undefined, valido = true): Dato =>
    valor == null || valor === "" || !valido ? { valor: null, estado: "faltante", evidencia: [] } : { valor, estado: "extraido", evidencia: ev };
  return {
    pisos: d(a.pisos, (a.pisos ?? 0) > 0),
    superficie_m2: d(a.superficieM2, (a.superficieM2 ?? 0) > 0),
    antiguedad_anios: d(a.antiguedad, (a.antiguedad ?? 0) > 0),
    dormitorios: d(a.dormitorios, (a.dormitorios ?? 0) > 0),
    banos: d(a.banos, (a.banos ?? 0) > 0),
    sistema_estructural: d(a.sistemaEstructural?.toLowerCase()),
    techumbre: d(a.estructuraTechumbre?.toLowerCase()),
    cubierta: d(a.cubierta?.toLowerCase()),
    pavimentos: d(a.pavimentos?.toLowerCase()),
  };
}

/** Cubicación por recinto del acta, con el nombre normalizado para cruzarlo con las secciones del presupuesto. */
export function cubicacionPorRecinto(a: ActaInspeccion): Record<string, Cubicacion & { nombre: string }> {
  const out: Record<string, Cubicacion & { nombre: string }> = {};
  for (const x of a.danos) out[norm(x.recinto)] = { nombre: x.recinto, ...cubicar({ alto: x.alto, largo: x.largo, ancho: x.ancho }) };
  return out;
}

export function mensajeDeCaso(e: EntradaAgente) {
  const cub = cubicacionPorRecinto(e.acta);
  const buscarCub = (seccion: string) => {
    const s = norm(seccion);
    return Object.entries(cub).find(([k]) => s.includes(k) || k.includes(s))?.[1];
  };
  return {
    caso: { modo: e.modo, fecha_siniestro: e.fechaSiniestro, uf_fecha_perdida: e.valorUF },
    constantes: { plancha_m2: PLANCHA_M2, cantidad_preventiva: CANTIDAD_PREVENTIVA },
    hechos_del_acta: e.acta.hechos,
    caracteristicas_base: caracteristicasDelActa(e.acta),
    danos_acta: e.acta.danos.map((d) => ({
      recinto: d.recinto,
      m2_danados: d.cantidad,
      tipo_dano: d.tipoDano,
      descripcion: d.descripcion,
      cubicacion: { ...cub[norm(d.recinto)] },
    })),
    reclamacion: e.reclamacion.lineas.map((l) => ({
      item: l.item,
      seccion: l.recinto,
      descripcion: l.descripcion,
      um: l.um,
      cantidad: l.cantidad,
      pu: l.pu,
      cubicacion_seccion: buscarCub(l.recinto) ?? null,
      baremo_candidatos: candidatos(l.descripcion, 4),
    })),
    precios_mercado_consultados: e.preciosMercado,
    fotos: e.fotos.map((f) => ({ id: f.id, recinto: f.recinto })),
    modo_instruccion:
      e.modo === "perdida_determinada"
        ? "No hay presupuesto del contratista: valoriza tú los trabajos necesarios según el acta y las fotos, solo en 'lineas_adicionales' (deja 'lineas' vacío), con precios de baremo."
        : "Decide cada partida de la reclamación en 'lineas'.",
  };
}

export type ResultadoAgente = {
  salida: SalidaAgente;
  validacion: ResultadoValidacion;
  intentos: number;
  modelo: string;
  promptVersion: string;
  tokensEntrada: number;
  tokensSalida: number;
};

/** Pide el ajuste y reintenta con los errores del validador hasta `maxIntentos` veces. */
export async function ajustarCaso(e: EntradaAgente, cliente: ClienteLlm, maxIntentos = 3): Promise<ResultadoAgente> {
  const schema = esquemaParaGemini(salidaAgenteSchema);
  const msg = JSON.stringify(mensajeDeCaso(e));
  const fotosIds = new Set(e.fotos.map((f) => f.id));
  const fuentes = new Set(e.preciosMercado.map((p) => p.fuente));
  const base: Parte[] = [{ text: `DATOS DEL CASO (JSON):\n${msg}` }];
  for (const f of e.fotos) {
    base.push({ text: `Foto ${f.id} — ${f.recinto}` });
    base.push({ inlineData: { mimeType: f.mime, data: f.base64 } });
  }
  let correcciones = "";
  let tin = 0;
  let tout = 0;
  let ultimo: { salida: SalidaAgente; validacion: ResultadoValidacion; modelo: string } | null = null;
  for (let i = 1; i <= maxIntentos; i++) {
    const partes = correcciones ? [...base, { text: `CORRIGE estos errores de tu respuesta anterior y devuelve el JSON completo:\n${correcciones}` }] : base;
    const r = await cliente.generarJson({ system: SYSTEM_PROMPT, partes, schema });
    tin += r.tokensEntrada ?? 0;
    tout += r.tokensSalida ?? 0;
    let json: unknown;
    try {
      json = JSON.parse(r.texto);
    } catch {
      correcciones = "La respuesta no era JSON válido.";
      continue;
    }
    const p = salidaAgenteSchema.safeParse(json);
    if (!p.success) {
      correcciones = p.error.issues.slice(0, 12).map((x) => `${x.path.join(".")}: ${x.message}`).join("\n");
      continue;
    }
    const validacion = validarSalida(p.data, { reclamacion: e.reclamacion, fotosIds, fuentesMercado: fuentes, modo: e.modo });
    ultimo = { salida: p.data, validacion, modelo: r.modelo };
    if (validacion.errores.length === 0) return { ...ultimo, intentos: i, promptVersion: PROMPT_VERSION, tokensEntrada: tin, tokensSalida: tout };
    correcciones = validacion.errores.slice(0, 25).join("\n");
  }
  if (!ultimo) throw new Error(`El agente no entregó una respuesta válida tras ${maxIntentos} intentos: ${correcciones}`);
  // Se devuelve el último intento con sus errores a la vista: el usuario decide en la pantalla de revisión.
  return { ...ultimo, intentos: maxIntentos, promptVersion: PROMPT_VERSION, tokensEntrada: tin, tokensSalida: tout };
}
