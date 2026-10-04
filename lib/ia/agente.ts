import { CANTIDAD_PREVENTIVA, PLANCHA_M2 } from "../domain/constantes";
import { salidaAgenteSchema, type DecisionLinea, type LineaReclamacion, type Reclamacion, type SalidaAgente, CLAVES_CARACTERISTICAS, type Dato } from "../domain/tipos";
import type { ActaInspeccion } from "../extraccion/acta";
import { candidatos } from "../engine/baremo";
import { cubicar, type Cubicacion } from "../engine/cubicacion";
import { armarFilas } from "../engine/filas";
import { calcularTotales } from "../engine/totales";
import { emitir } from "../traza";
import { esquemaParaGemini, type ClienteLlm, type Parte } from "./gemini";
import { clasificacionPorDefecto, clasificacionSchema, decidirLinea, loteSchema, type Clasificacion, type ContextoLinea } from "./motor-ajuste";
import { PROMPT_VERSION, SYSTEM_CLASIFICAR, SYSTEM_NARRATIVA } from "./prompt";
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

const coincide = (a: string, b: string) => a !== "" && b !== "" && (a.includes(b) || b.includes(a));

/** Medidas del recinto al que pertenece una partida: cubicación y m² dañados del acta. */
export function contextoDe(e: EntradaAgente, l: LineaReclamacion): ContextoLinea {
  const s = norm(l.recinto);
  const cub = Object.entries(cubicacionPorRecinto(e.acta)).find(([k]) => coincide(s, k))?.[1] ?? null;
  const m2 = e.acta.danos.filter((d) => coincide(s, norm(d.recinto))).reduce((t, d) => t + (d.cantidad ?? 0), 0);
  return { cub, m2Acta: m2 > 0 ? Math.round(m2 * 100) / 100 : null };
}

const TAM_LOTE = 10;
const PARALELO = 3;

export type Lote = { lineas: LineaReclamacion[]; texto: string };

/** Partidas agrupadas de a pocas, con solo el contexto que cada una necesita: peticiones chicas que cualquier modelo contesta rápido. */
export function lotesDeClasificacion(e: EntradaAgente, lineas = e.reclamacion.lineas): Lote[] {
  const lotes: Lote[] = [];
  for (let i = 0; i < lineas.length; i += TAM_LOTE) {
    const grupo = lineas.slice(i, i + TAM_LOTE);
    const datos = {
      caso: { fecha_siniestro: e.fechaSiniestro, hechos_del_acta: (e.acta.hechos ?? "").slice(0, 700), plancha_m2: PLANCHA_M2, cantidad_preventiva: CANTIDAD_PREVENTIVA },
      partidas: grupo.map((l) => {
        const c = contextoDe(e, l);
        const dano = e.acta.danos.find((d) => coincide(norm(l.recinto), norm(d.recinto)));
        return {
          item: l.item,
          seccion: l.recinto,
          descripcion: l.descripcion,
          um: l.um,
          cantidad: l.cantidad,
          pu: l.pu,
          m2_danados_acta: c.m2Acta,
          dano_en_acta: dano ? { tipo: dano.tipoDano, descripcion: dano.descripcion } : null,
          medidas_recinto: c.cub ? { muro_neto: c.cub.muroNeto, pano: c.cub.pano, cielo: c.cub.cielo, piso: c.cub.piso, ml: c.cub.ml } : null,
          baremo_candidatos: candidatos(l.descripcion, 4),
        };
      }),
    };
    lotes.push({ lineas: grupo, texto: `PARTIDAS A CLASIFICAR (JSON):\n${JSON.stringify(datos)}` });
  }
  return lotes;
}

export type ResultadoAgente = {
  salida: SalidaAgente;
  validacion: ResultadoValidacion;
  intentos: number;
  modelo: string;
  promptVersion: string;
  tokensEntrada: number;
  tokensSalida: number;
  avisos: string[];
};

type Acumulado = { tin: number; tout: number; llamadas: number; modelos: Set<string>; avisos: string[] };

const aviso = (a: Acumulado, t: string) => {
  if (!a.avisos.includes(t)) a.avisos.push(t);
};

async function conLimite<T, R>(lista: T[], limite: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(lista.length);
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, lista.length) }, async () => {
      while (siguiente < lista.length) {
        const i = siguiente++;
        out[i] = await fn(lista[i], i);
      }
    }),
  );
  return out;
}

function leerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/** Pide la clasificación de un lote; lo que el modelo no entregue bien se pide una vez más y, si sigue faltando, lo resuelve el motor por defecto. */
async function clasificarLote(e: EntradaAgente, lote: Lote, n: number, total: number, cliente: ClienteLlm, acu: Acumulado): Promise<Map<string, Clasificacion>> {
  const schema = esquemaParaGemini(loteSchema);
  const buenas = new Map<string, Clasificacion>();
  let pendientes = lote.lineas;
  for (let intento = 1; intento <= 2 && pendientes.length > 0; intento++) {
    const texto = intento === 1 ? lote.texto : lotesDeClasificacion(e, pendientes)[0].texto;
    emitir("info", "clasificar", `Lote ${n}/${total}: se pide clasificar ${pendientes.length} partida(s)${intento > 1 ? " (reintento de las que faltaron)" : ""}`);
    const r = await cliente.generarJson({ system: SYSTEM_CLASIFICAR, partes: [{ text: texto }], schema, maxSalida: 8192 });
    acu.llamadas++;
    acu.tin += r.tokensEntrada ?? 0;
    acu.tout += r.tokensSalida ?? 0;
    acu.modelos.add(r.modelo);
    for (const a of r.avisos ?? []) aviso(acu, a);
    const j = leerJson(r.texto) as { decisiones?: unknown[] } | null;
    const items = new Set(pendientes.map((l) => l.item));
    for (const d of Array.isArray(j?.decisiones) ? j.decisiones : []) {
      const p = clasificacionSchema.safeParse(d);
      if (p.success && items.has(p.data.item)) buenas.set(p.data.item, p.data);
    }
    pendientes = lote.lineas.filter((l) => !buenas.has(l.item));
    emitir(pendientes.length === 0 ? "ok" : "error", "clasificar", pendientes.length === 0 ? `Lote ${n}/${total}: ${lote.lineas.length} partida(s) clasificada(s)` : `Lote ${n}/${total}: faltan ${pendientes.length} partida(s) bien formadas (${pendientes.map((l) => l.item).join(", ")})`, pendientes.length ? r.texto.slice(0, 500) : undefined);
  }
  return buenas;
}

type Digesto = { directoReclamado: number; directoAjustado: number; ufReclamada: number; ufAjustada: number; porLetra: Record<string, number>; partidas: number };

function digestoDe(e: EntradaAgente, lineas: DecisionLinea[]): Digesto {
  const filas = armarFilas({ caso: { modo: e.modo }, reclamacion: e.reclamacion, decisiones: lineas, adicionales: [] });
  const p = { ggPct: e.reclamacion.ggPct, utilidadPct: e.reclamacion.utilidadPct, ivaPct: e.reclamacion.ivaPct, valorUF: e.valorUF };
  const rec = calcularTotales(filas.flatMap((f) => (f.tipo === "linea" && f.rec ? [f.rec] : [])), p);
  const aj = calcularTotales(filas.flatMap((f) => (f.tipo === "linea" && f.aj ? [f.aj] : [])), p);
  const porLetra: Record<string, number> = {};
  for (const f of filas) if (f.tipo === "linea") for (const o of f.obs) porLetra[o] = (porLetra[o] ?? 0) + 1;
  return { directoReclamado: Math.round(rec.directo), directoAjustado: Math.round(aj.directo), ufReclamada: Math.round(rec.uf * 100) / 100, ufAjustada: Math.round(aj.uf * 100) / 100, porLetra, partidas: lineas.length };
}

type Narrativa = Omit<SalidaAgente, "lineas">;

/** Redacción mínima cuando el modelo no pudo hacerla: todo sale del acta y de las cifras del motor. Nunca deja el ajuste sin informe. */
function narrativaAutomatica(e: EntradaAgente, d: Digesto): Narrativa {
  const caracteristicas = caracteristicasDelActa(e.acta);
  const letras = Object.entries(d.porLetra).map(([l, n]) => `${l}: ${n}`).join(", ") || "sin observaciones";
  return {
    caracteristicas,
    evidencia_observada: e.acta.danos.map((x) => ({ recinto: x.recinto, vineta: `${x.recinto}: ${x.cantidad ?? 0} m² con daño de tipo ${x.tipoDano || "no clasificado"} registrado en el acta de inspección.`, m2_acta: x.cantidad ?? null, atribuible: true, fotos: [] })),
    lineas_adicionales: [],
    ajuste_de_perdida_texto:
      "El ajuste se realizó sobre la medición del acta de inspección y precios de baremo a todo costo, acotando las cantidades a los m² dañados y a los mínimos técnicos constructivos, y excluyendo los daños por mantenimiento, desgaste o deterioro progresivo.",
    resumen_ajuste: [
      `Se revisaron ${d.partidas} partidas contra el máximo permitido: precio de baremo a todo costo y cantidad de la medición del acta.`,
      `Observaciones aplicadas (cantidad de partidas): ${letras}.`,
      `El total reclamado de UF ${d.ufReclamada} quedó ajustado en UF ${d.ufAjustada}.`,
    ],
    faltantes: Object.entries(caracteristicas).filter(([, v]) => v.estado === "faltante").map(([k]) => ({ campo: k, motivo: "No consta en el acta ni pudo deducirse de las fotografías." })),
  };
}

const esDeLineas = (m: string) => /^(La partida|Falta decidir|Partida )/.test(m);

function datosNarrativa(e: EntradaAgente, d: Digesto | null) {
  const cub = cubicacionPorRecinto(e.acta);
  return {
    caso: { modo: e.modo, fecha_siniestro: e.fechaSiniestro, uf_fecha_perdida: e.valorUF },
    hechos_del_acta: e.acta.hechos,
    caracteristicas_base: caracteristicasDelActa(e.acta),
    danos_acta: e.acta.danos.map((x) => ({ recinto: x.recinto, m2_danados: x.cantidad, tipo_dano: x.tipoDano, descripcion: x.descripcion, cubicacion: { ...cub[norm(x.recinto)] }, baremo_candidatos: candidatos(`${x.tipoDano} ${x.descripcion}`, 3) })),
    digesto_de_decisiones_del_sistema: d ?? "(se calcula al ejecutar)",
    precios_mercado_consultados: e.preciosMercado,
    fotos: e.fotos.map((f) => ({ id: f.id, recinto: f.recinto })),
    modo_instruccion:
      e.modo === "perdida_determinada"
        ? "No hay presupuesto del contratista: valoriza tú los trabajos necesarios según el acta y las fotos, solo en 'lineas_adicionales', con precios de baremo."
        : "Las partidas del presupuesto ya están decididas por el sistema; en 'lineas_adicionales' solo agrega daños del acta que el contratista no cobró (si no hay, deja la lista vacía).",
  };
}

/** Redacta la parte descriptiva con las fotos; si el modelo falla o no cumple las reglas tras dos intentos, se usa la redacción automática. */
async function redactar(e: EntradaAgente, lineas: DecisionLinea[], d: Digesto, cliente: ClienteLlm, acu: Acumulado): Promise<Narrativa> {
  const schema = esquemaParaGemini(salidaAgenteSchema.omit({ lineas: true }));
  const datos = datosNarrativa(e, d);
  const base: Parte[] = [{ text: `DATOS DEL CASO (JSON):\n${JSON.stringify(datos)}` }];
  for (const f of e.fotos) {
    base.push({ text: `Foto ${f.id} — ${f.recinto}` });
    base.push({ inlineData: { mimeType: f.mime, data: f.base64 } });
  }
  const fotosIds = new Set(e.fotos.map((f) => f.id));
  const fuentes = new Set(e.preciosMercado.map((p) => p.fuente));
  let correcciones = "";
  for (let intento = 1; intento <= 2; intento++) {
    emitir("info", "redactar", `Redacción ${intento}/2: características, evidencia, texto y resumen${e.fotos.length ? ` (con ${e.fotos.length} fotos)` : ""}`, correcciones || undefined);
    const partes = correcciones ? [...base, { text: `CORRIGE estos errores de tu respuesta anterior y devuelve el JSON completo:\n${correcciones}` }] : base;
    try {
      const r = await cliente.generarJson({ system: SYSTEM_NARRATIVA, partes, schema });
      acu.llamadas++;
      acu.tin += r.tokensEntrada ?? 0;
      acu.tout += r.tokensSalida ?? 0;
      acu.modelos.add(r.modelo);
      for (const a of r.avisos ?? []) aviso(acu, a);
      const p = salidaAgenteSchema.omit({ lineas: true }).safeParse(leerJson(r.texto));
      if (!p.success) {
        correcciones = p.error.issues.slice(0, 12).map((x) => `${x.path.join(".")}: ${x.message}`).join("\n");
        emitir("error", "redactar", `La redacción no cumple el esquema (${p.error.issues.length} problemas)`, correcciones);
        continue;
      }
      const v = validarSalida({ ...p.data, lineas }, { reclamacion: e.reclamacion, fotosIds, fuentesMercado: fuentes, modo: e.modo });
      const propios = v.errores.filter((m) => !esDeLineas(m));
      if (propios.length === 0) {
        emitir("ok", "redactar", "Redacción validada");
        return p.data;
      }
      correcciones = propios.slice(0, 20).join("\n");
      emitir("error", "redactar", `La redacción incumple ${propios.length} regla(s)`, correcciones);
    } catch (err) {
      emitir("error", "redactar", `No se pudo redactar: ${err instanceof Error ? err.message : "error"}`);
      aviso(acu, `La redacción con IA no estuvo disponible (${err instanceof Error ? err.message.slice(0, 160) : "error"}): se usó el texto automático basado en el acta.`);
      return narrativaAutomatica(e, d);
    }
  }
  aviso(acu, "La IA no logró una redacción válida tras dos intentos: se usó el texto automático basado en el acta.");
  return narrativaAutomatica(e, d);
}

/**
 * Ajuste en dos pasos. 1) El modelo clasifica las partidas por lotes y el motor contrasta lo presupuestado con el máximo
 * permitido (baremo y medición del acta). 2) El modelo redacta la parte descriptiva con las fotos. Si un paso del modelo
 * falla por formato, el motor resuelve por defecto y deja el aviso; un fallo de conexión con todos los proveedores sí se propaga.
 */
export async function ajustarCaso(e: EntradaAgente, cliente: ClienteLlm): Promise<ResultadoAgente> {
  const acu: Acumulado = { tin: 0, tout: 0, llamadas: 0, modelos: new Set(), avisos: [] };
  const lotes = e.modo === "reclamacion" ? lotesDeClasificacion(e) : [];
  emitir("info", "clasificar", lotes.length ? `${e.reclamacion.lineas.length} partidas en ${lotes.length} lote(s) de hasta ${TAM_LOTE}, hasta ${PARALELO} a la vez` : "Sin presupuesto del contratista: no hay partidas que clasificar");
  const resultados = await conLimite(lotes, PARALELO, (l, i) => clasificarLote(e, l, i + 1, lotes.length, cliente, acu));
  const clasif = new Map<string, Clasificacion>();
  for (const m of resultados) for (const [k, v] of m) clasif.set(k, v);

  const lineas: DecisionLinea[] = [];
  let porDefecto = 0;
  for (const l of e.modo === "reclamacion" ? e.reclamacion.lineas : []) {
    const c = clasif.get(l.item) ?? (porDefecto++, clasificacionPorDefecto(l));
    const r = decidirLinea(l, c, contextoDe(e, l));
    if (r.aviso) aviso(acu, r.aviso);
    lineas.push(r.decision);
  }
  if (porDefecto > 0) aviso(acu, `${porDefecto} partida(s) no fueron clasificadas por la IA y se resolvieron con las reglas automáticas (precio al baremo más parecido, cantidad reclamada): revísalas.`);
  const d = digestoDe(e, lineas);
  emitir("ok", "motor", `Motor aplicado a ${lineas.length} partidas: UF reclamada ${d.ufReclamada} → ajustada ${d.ufAjustada}; observaciones ${Object.entries(d.porLetra).map(([l, n]) => `${l}=${n}`).join(" ") || "ninguna"}`);

  const narrativa = await redactar(e, lineas, d, cliente, acu);
  const salida: SalidaAgente = { ...narrativa, lineas };
  const validacion = validarSalida(salida, { reclamacion: e.reclamacion, fotosIds: new Set(e.fotos.map((f) => f.id)), fuentesMercado: new Set(e.preciosMercado.map((p) => p.fuente)), modo: e.modo });
  emitir(validacion.errores.length === 0 ? "ok" : "error", "validar", validacion.errores.length === 0 ? "Validación de reglas de oro superada" : `La validación encontró ${validacion.errores.length} error(es)`, validacion.errores.slice(0, 10).join("\n") || undefined);
  return { salida, validacion, intentos: acu.llamadas, modelo: [...acu.modelos].join(" + ") || "motor automático", promptVersion: PROMPT_VERSION, tokensEntrada: acu.tin, tokensSalida: acu.tout, avisos: acu.avisos };
}

/** Tamaños de lo que se enviará en cada paso, sin llamar a la IA (para la vista previa). */
export function tamanosDelAjuste(e: EntradaAgente) {
  const lotes = e.modo === "reclamacion" ? lotesDeClasificacion(e) : [];
  return {
    lotes: lotes.map((l) => ({ partidas: l.lineas.length, caracteres: l.texto.length, desde: l.lineas[0].item, hasta: l.lineas[l.lineas.length - 1].item })),
    instruccionesClasificar: SYSTEM_CLASIFICAR.length,
    instruccionesRedactar: SYSTEM_NARRATIVA.length,
    datosRedactar: JSON.stringify(datosNarrativa(e, null)).length,
    muestraLote: lotes[0]?.texto.slice(0, 1800) ?? "",
  };
}
