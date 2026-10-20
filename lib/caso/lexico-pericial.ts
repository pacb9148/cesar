/**
 * Léxico técnico pericial para describir los daños observados (glosario de «fuente/El ajustador no ajusta…», 180 términos en 8 categorías). El acta de
 * inspección describe los daños en lenguaje coloquial y a veces cortado («Muro inflado por filtración y…»); aquí se traduce a término técnico + descripción
 * pericial SOLO cuando el texto lo sustenta: nunca se agrega un daño que el acta o las fotos no muestren, ni se atribuye una causa.
 */

export type Categoria = "cubierta" | "eolica" | "cielo" | "muro" | "piso" | "accesorio" | "mecanismo";
type Entrada = readonly [numero: number, categoria: Categoria, termino: string, pericial: string];

// [n.º del glosario, categoría, término técnico, descripción pericial]
export const GLOSARIO: readonly Entrada[] = [
  // A. Patologías de cubierta (origen de filtración)
  [1, "cubierta", "desprendimiento de tejuela asfáltica", "pérdida de adherencia de la teja asfáltica sobre el tablero de apoyo"],
  [2, "cubierta", "levantamiento de plancha metálica", "despegue parcial de plancha de zinc aluminizado o galvanizado de su fijación"],
  [3, "cubierta", "pérdida de adherencia de membrana impermeabilizante", "descolamiento del manto asfáltico o de polímero del sustrato"],
  [4, "cubierta", "fisura en membrana impermeabilizante", "agrietamiento del manto que compromete la estanqueidad"],
  [5, "cubierta", "rotura de plancha de policarbonato", "ruptura estructural de la plancha alveolar translúcida"],
  [6, "cubierta", "desprendimiento de fijaciones mecánicas", "pérdida de tornillería o pernos de anclaje de planchas"],
  [7, "cubierta", "sobreflujo en canaleta", "desborde del canalón por capacidad insuficiente u obstrucción"],
  [8, "cubierta", "obstrucción de sumidero", "colmatación del punto de desagüe de la cubierta"],
  [9, "cubierta", "desprendimiento de cumbrera", "pérdida del remate superior de la cubierta a dos aguas"],
  [10, "cubierta", "desplazamiento de teja cerámica", "movimiento lateral o longitudinal de la pieza cerámica"],
  [13, "cubierta", "embotamiento de plancha metálica", "deformación plástica por impacto o carga puntual"],
  [14, "cubierta", "corrosión perforante en plancha metálica", "oxidación que genera perforación y pérdida de estanqueidad"],
  [15, "cubierta", "desprendimiento de alero", "pérdida del voladizo perimetral de la cubierta"],
  [17, "cubierta", "pérdida de estanqueidad en junta de solape", "falla del solape entre planchas o tejas"],
  [18, "cubierta", "desprendimiento de remate en borde", "pérdida del perfil de remate en el borde de la cubierta"],
  [20, "cubierta", "pudrición en madera de cubierta", "degradación biológica del maderamen por humedad crónica"],
  [21, "cubierta", "ataque de polilla en maderamen", "perforación biológica en vigas o contrahayas"],
  [22, "cubierta", "meteorización de tejuela asfáltica", "envejecimiento del material por exposición a radiación UV y ciclos térmicos"],
  [23, "cubierta", "grieta en tablero de apoyo", "fisura en el tablero que soporta la cubrición"],
  [25, "cubierta", "falla en sellado de penetración", "pérdida de estanqueidad en la unión de tubería o ducto con la cubierta"],
  // B. Daños por acción eólica (descripción de la lesión, sin atribución de causa)
  [26, "eolica", "levantamiento leve de plancha metálica", "despegue parcial sin pérdida total de fijación"],
  [28, "eolica", "voladura de tejuela en sector puntual", "desprendimiento completo de una o varias piezas"],
  [29, "eolica", "desplazamiento de plancha de policarbonato", "movimiento de la plancha fuera de su encaje"],
  [30, "eolica", "ruptura de plancha de policarbonato", "fractura estructural por sobrecarga puntual"],
  [32, "eolica", "levantamiento de alero", "despegue del voladizo perimetral de su apoyo"],
  [35, "eolica", "deformación de plancha metálica", "distorsión plástica sin rotura"],
  [44, "eolica", "deformación por pandeo de plancha metálica", "flexión lateral de la plancha"],
  [45, "eolica", "desprendimiento de canaleta de su apoyo", "pérdida del canalón de evacuación"],
  // C. Consecuencias en entrepisos / cielos
  [46, "cielo", "huella de filtración", "mácula oscura por ingreso de agua en el entrepiso"],
  [47, "cielo", "abombamiento de placa de yeso-cartón", "deformación convexa por absorción de humedad"],
  [48, "cielo", "desprendimiento de placa de yeso-cartón", "caída o despegue total de la placa de su soporte"],
  [49, "cielo", "pérdida de rigidez en placa de yeso-cartón", "reblandecimiento del núcleo de yeso por saturación"],
  [50, "cielo", "condensación superficial", "presencia de gotículas de agua por diferencia térmica"],
  [51, "cielo", "colonización fúngica", "crecimiento de moho (Aspergillus, Penicillium) en superficie"],
  [52, "cielo", "escurrimiento", "goteo o flujo de agua sobre el entrevigado"],
  [53, "cielo", "pudrición húmeda en entrevigado de madera", "degradación biológica de vigas o contrahayas"],
  [54, "cielo", "ataque fúngico en machihembrado", "colonización de hongos en el entablado del entrepiso"],
  [55, "cielo", "desprendimiento de entablado machihembrado", "caída o despegue de las tablas"],
  [56, "cielo", "deformación por hinchazón de tablero OSB", "abombamiento del tablero por absorción de humedad"],
  [57, "cielo", "deslaminación de tablero MDF", "separación de las fibras del tablero por humedad"],
  [59, "cielo", "desprendimiento de pintura", "caída del acabado de pintura por pérdida de adherencia"],
  [61, "cielo", "fisura en placa de yeso-cartón", "agrietamiento de la placa por deformación o impacto"],
  [64, "cielo", "goteo activo", "ingreso de agua en estado líquido con flujo gravitacional"],
  [65, "cielo", "humedad residual", "presencia de humedad sin goteo activo (secado en curso)"],
  // D. Consecuencias en paramentos / muros
  [66, "muro", "huella de filtración", "mácula de humedad en el muro"],
  [67, "muro", "escurrimiento", "flujo de agua por la superficie del muro"],
  [68, "muro", "eflorescencia", "depósito de sales (salitre) en la superficie del muro"],
  [69, "muro", "desprendimiento de enlucido", "caída del mortero de revestimiento del muro"],
  [70, "muro", "descolamiento de pintura", "pérdida de adherencia del acabado de pintura"],
  [71, "muro", "inflamiento de pintura", "levantamiento de la capa de pintura por humedad subyacente"],
  [72, "muro", "colonización fúngica", "crecimiento de moho en la superficie del muro"],
  [73, "muro", "fisura en paramento", "agrietamiento del muro por movimiento o humedad"],
  [74, "muro", "grieta en junta", "apertura en la junta de mortero entre bloques"],
  [75, "muro", "desprendimiento de pintura en zócalo", "caída del acabado de pintura en la parte inferior del muro"],
  [76, "muro", "humedad capilar", "ascensión de agua desde la base del muro"],
  [77, "muro", "condensación en paramento", "presencia de humedad por diferencia térmica (puente térmico)"],
  [78, "muro", "descolamiento de papel pintado", "pérdida de adherencia del revestimiento decorativo"],
  [79, "muro", "desprendimiento de texturado", "caída del acabado texturizado del muro"],
  [81, "muro", "desprendimiento de revestimiento cerámico", "caída de la cerámica del muro"],
  [82, "muro", "descoloración", "cambio de tono por humedad o eflorescencia"],
  [83, "accesorio", "fisura en marco de carpintería de ventana", "agrietamiento del cerco de la ventana"],
  [84, "accesorio", "grieta en junta entre marco y paramento", "apertura en el sellado entre el cerco y el muro"],
  [85, "muro", "desprendimiento de rodapié", "caída del zócalo de la base del muro"],
  [86, "muro", "humedad en junta de dilatación", "presencia de agua en la junta de movimiento"],
  // E. Consecuencias en pisos / solados
  [88, "piso", "hinchazón de piso laminado", "abombamiento del tablero por absorción de humedad"],
  [89, "piso", "descolamiento de piso flotante", "separación de las tablas del revestimiento de piso"],
  [91, "piso", "desprendimiento de zócalo", "caída del rodapié de la unión piso-muro"],
  [92, "piso", "escurrimiento en superficie de piso", "presencia de agua líquida sobre el revestimiento"],
  [93, "piso", "descoloración en piso laminado", "cambio de tono por humedad o mancha química"],
  [95, "piso", "desprendimiento de cerámica de piso", "caída de la pieza cerámica del mortero de adherencia"],
  [96, "piso", "fisura en losa de hormigón", "agrietamiento de la losa de piso"],
  [98, "piso", "hinchazón de rodapié", "abombamiento del zócalo por humedad"],
  // F. Consecuencias en cornisas y accesorios
  [101, "accesorio", "desprendimiento de cornisa", "caída del elemento de remate de alero o cielo"],
  [102, "accesorio", "fisura en cornisa", "agrietamiento del elemento de remate superior"],
  [103, "accesorio", "descolamiento de pintura en cornisa", "pérdida de adherencia del acabado de la cornisa"],
  [110, "accesorio", "corrosión en herrajes de carpintería", "oxidación de bisagras, cerraduras o herrajes metálicos"],
  // H. Términos complementarios (mecanismos y estados)
  [161, "mecanismo", "filtración gravitacional", "ingreso de agua por gravedad desde la cubierta"],
  [162, "mecanismo", "infiltración por presión", "ingreso de agua por presión de viento o lluvia"],
  [164, "mecanismo", "capilaridad", "ascensión de agua por fuerzas capilares"],
  [165, "mecanismo", "condensación de rocío", "formación de gotas por enfriamiento por debajo del punto de rocío"],
  [166, "mecanismo", "puente térmico", "zona de mayor transmisión de calor que genera condensación"],
  [167, "mecanismo", "estanqueidad", "capacidad de un elemento de impedir el paso de agua"],
  [174, "mecanismo", "saturación", "estado en que el material ha absorbido el máximo de agua"],
  [175, "mecanismo", "desecación", "proceso de pérdida de humedad por evaporación"],
  [177, "mecanismo", "deformación por hinchamiento", "cambio dimensional por absorción de humedad"],
  [178, "mecanismo", "deformación por retracción", "cambio dimensional por pérdida de humedad"],
  [179, "mecanismo", "fatiga por ciclos húmedos-secos", "degradación por repeticiones de absorción y desecación"],
  [180, "mecanismo", "meteorización", "degradación por exposición a agentes atmosféricos"],
  // Términos genéricos propios (n.º ≥ 1000, no vienen del glosario): para lo que el acta dice sin precisar material, sin atribuirle uno.
  [1001, "cubierta", "rotura de elemento de cubierta", "ruptura o perforación del material de cobertura"],
  [1002, "cubierta", "desprendimiento de elemento de cubierta", "pérdida de planchas, tejas o remates de la cubierta"],
  [1004, "mecanismo", "presencia de humedad", "humedad en la superficie del elemento"],
  [1005, "mecanismo", "mácula", "cambio de color localizado, sin pérdida de material"],
  [1006, "mecanismo", "escurrimiento", "flujo de agua sobre la superficie del elemento"],
  [1007, "mecanismo", "deformación por pandeo", "cambio de forma del elemento por flexión"],
];

const porNumero = new Map(GLOSARIO.map((g) => [g[0], g]));
const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Jerarquía de severidad de lo observado, de menor a mayor: se nombra primero lo leve y después lo más grave. */
export const SEVERIDAD = ["mácula (solo cambio de color)", "descoloración (cambio de tono más extenso)", "desprendimiento (pérdida de material: pintura, enlucido)", "deformación (cambio de forma: abombamiento, hinchazón)", "fisura / grieta (ruptura del material)"] as const;

/** «superficie» = el acta no dice en qué elemento está el daño (ni lo dicen los hechos): se describe sin inventarlo. */
export type Elemento = "cielo" | "muro" | "piso" | "cubierta" | "accesorio" | "superficie";

// Qué manifestación del daño sustenta cada palabra del acta, por elemento: [expresión sobre el texto sin tildes, n.º del glosario, severidad 1–5].
// El cuarto valor (opcional) es una condición extra sobre el texto: evita atribuir un material o un estado que el acta no menciona.
type Regla = readonly [RegExp, number, 1 | 2 | 3 | 4 | 5, ((t: string) => boolean)?];
const REGLAS: Record<Elemento, readonly Regla[]> = {
  cielo: [
    [/goteo|gotea|gotera/, 64, 1],
    [/filtraci/, 46, 1],
    [/escurr/, 52, 1],
    [/humedad/, 1004, 1, (t) => !/filtraci|goteo|gotea|gotera|escurr/.test(t)],
    [/hongo|moho|fung/, 51, 2],
    [/abomb|inflad|hinch|globo/, 47, 4],
    [/pandeo|deform/, 47, 4],
    [/desprend|cai(d|do)|despegad|desplom/, 48, 3],
    [/pintura.*(levant|desprend|salt)|descolam/, 59, 3],
    [/fisura|grieta|rajad/, 61, 5],
  ],
  muro: [
    [/filtraci|mancha|macula|huella/, 66, 1],
    [/humedad/, 1004, 1, (t) => !/filtraci|mancha|macula|huella/.test(t)],
    [/escurr|goteo/, 67, 1],
    [/capilar|ascen/, 76, 1],
    [/condensa/, 77, 1],
    [/descolor|decolor/, 82, 2],
    [/hongo|moho|fung/, 72, 2],
    [/eflorescen|salitre/, 68, 2],
    [/enlucido|estuco|mortero.*(cai|desprend)|desprend.*(enlucido|estuco)/, 69, 3],
    [/pintura.*(levant|desprend|salt)|descolam/, 70, 3],
    [/inflad|abomb|hinch|globo/, 71, 4],
    [/fisura|grieta|rajad/, 73, 5],
  ],
  piso: [
    [/escurr|agua/, 92, 1],
    [/mancha|descolor|decolor/, 93, 2],
    [/separ|descol/, 89, 3],
    [/hinch|abomb|inflad|deform/, 88, 4],
    [/fisura|grieta|rajad/, 96, 5],
  ],
  cubierta: [
    [/obstru|sumidero/, 8, 2],
    [/canal|canaleta|rebos|desbord/, 7, 2],
    [/solape|estanque|filtraci|gotera/, 17, 2],
    [/corros|oxid|perfor/, 14, 3],
    [/levant|despeg|suelta/, 2, 3],
    [/desplaz|movid|corrid/, 10, 3, (t) => /teja/.test(t)],
    [/desprend|volad|arranc/, 28, 3, (t) => /teja/.test(t)],
    [/desprend|volad|arranc/, 1002, 3, (t) => !/teja/.test(t)],
    [/pandeo|deform|abolla|golpe/, 35, 4, (t) => /plancha|zinc|metal/.test(t)],
    [/rot[oa]s?\b|romp|quebr|ruptur|fractur/, 5, 5, (t) => /policarbonato/.test(t)],
    [/rot[oa]s?\b|romp|quebr|ruptur|fractur/, 1001, 5, (t) => !/policarbonato/.test(t)],
  ],
  accesorio: [
    [/union abierta|junta|sello|vano|abiert/, 84, 5],
    [/fisura|grieta|rajad/, 83, 5],
  ],
  superficie: [
    [/mancha|macula/, 1005, 1, (t) => !/hongo|moho|fung/.test(t)],
    [/escurr/, 1006, 1],
    [/humedad/, 1004, 1, (t) => !/escurr/.test(t)],
    [/hongo|moho|fung/, 51, 2],
    [/pandeo|abomb|inflad|hinch|deform/, 1007, 4],
  ],
};

const NOMBRE: Record<Elemento, string> = { cielo: "cielo", muro: "muro", piso: "piso", cubierta: "cubierta", accesorio: "carpintería", superficie: "superficie" };
const DETECTA_ELEMENTO: [Elemento, RegExp][] = [
  ["cielo", /cielo/],
  ["muro", /pared|muro|tabique|paramento/],
  ["cubierta", /cubierta|techumbre|techo|zinc|policarbonato|teja|alero|canaleta/],
  ["piso", /piso|pavimento|radier|alfombra|flotante/],
  ["accesorio", /ventana|vano|marco|puerta|vidrio/],
];

/** Material que nombra el texto, para precisar el elemento («cielo de placa de yeso-cartón»); si no lo nombra, no se asume. */
function material(t: string): string {
  if (/yeso|volcanita|carton/.test(t)) return "de placa de yeso-cartón";
  if (/machihembr|madera|entablad/.test(t)) return "de madera";
  if (/osb|terciado/.test(t)) return "de tablero";
  return "";
}

export type Manifestacion = { numero: number; termino: string; pericial: string; severidad: number };

/** Manifestaciones del daño que el texto sustenta para un elemento, de menor a mayor severidad y sin repetir el término. */
export function manifestaciones(texto: string, elemento: Elemento): Manifestacion[] {
  const t = sinTildes(texto);
  const vistos = new Set<number>();
  const salida: Manifestacion[] = [];
  for (const [re, n, sev, condicion] of REGLAS[elemento]) {
    if (!re.test(t) || vistos.has(n) || (condicion && !condicion(t))) continue;
    vistos.add(n);
    const g = porNumero.get(n);
    if (g) salida.push({ numero: n, termino: g[2], pericial: g[3], severidad: sev });
  }
  return salida.sort((a, b) => a.severidad - b.severidad || a.numero - b.numero);
}

/** Elementos que nombra el texto, en el orden en que aparecen. */
export function elementosNombrados(texto: string): Elemento[] {
  const t = sinTildes(texto);
  return DETECTA_ELEMENTO.map(([e, re]) => [e, t.search(re)] as const).filter(([, p]) => p >= 0).sort((a, b) => a[1] - b[1]).map(([e]) => e);
}

/**
 * Descripción pericial del daño de una estancia: término técnico con su descripción, del hallazgo más leve al más grave
 * («Huella de filtración en cielo (mácula oscura por ingreso de agua en el entrepiso), con abombamiento de placa de yeso-cartón (deformación convexa…)»).
 * `elementosContexto` completa el elemento cuando el acta no lo nombra (p. ej. lo dicen los hechos: «humedad en el cielo del quincho»).
 * Devuelve null si el texto no sustenta ninguna manifestación: quien llama usa entonces su redacción simple (no se inventa nada).
 */
export function descripcionPericial(texto: string, elementosContexto: Elemento[] = []): string | null {
  const nombrados = elementosNombrados(texto);
  const elementos: Elemento[] = nombrados.length ? nombrados : elementosContexto.length ? elementosContexto : ["superficie"];
  const principal = elementos[0];
  const lista = manifestaciones(texto, principal).slice(0, 3);
  if (lista.length === 0) return null;
  const mat = material(sinTildes(texto));
  const donde = `${elementos.map((e) => NOMBRE[e]).join(" y ")}${elementos.length === 1 && principal !== "accesorio" && principal !== "cubierta" && mat ? ` ${mat}` : ""}`;
  const [primera, ...resto] = lista;
  // Los términos de cubierta y carpintería ya dicen dónde ocurre («levantamiento de plancha metálica», «grieta en junta entre marco y paramento»): no se repite el elemento.
  const partes = [`${mayus(primera.termino)}${principal === "accesorio" || principal === "cubierta" ? "" : ` en ${donde}`} (${primera.pericial})`, ...resto.map((m) => `${m.termino} (${m.pericial})`)];
  return `${partes[0]}${partes.length > 1 ? `, con ${partes.slice(1).join(" y ")}` : ""}.`;
}

/** Glosario compacto para guiar a la IA al redactar la evidencia observada (por categoría, «término = descripción»). */
export function glosarioParaPrompt(): string {
  const TITULO: Record<Categoria, string> = { cubierta: "Cubierta (origen de filtración)", eolica: "Daños por acción eólica (describir la lesión, sin atribuir causa)", cielo: "Entrepisos y cielos", muro: "Paramentos y muros", piso: "Pisos", accesorio: "Cornisas, carpintería y accesorios", mecanismo: "Mecanismos y estados" };
  const grupos = new Map<Categoria, string[]>();
  for (const [, c, t, d] of GLOSARIO) grupos.set(c, [...(grupos.get(c) ?? []), `${t} = ${d}`]);
  return [...grupos.entries()].map(([c, xs]) => `${TITULO[c]}:\n${xs.map((x) => `- ${x}`).join("\n")}`).join("\n");
}
