import { describe, it, expect } from "vitest";
import { descripcionPericial, glosarioParaPrompt, GLOSARIO, manifestaciones, SEVERIDAD } from "../lib/caso/lexico-pericial";
import { vinetaDeDano } from "../lib/caso/parrafo-inmueble";
import { SYSTEM_NARRATIVA } from "../lib/ia/prompt";

// Daños tal como los trae el acta del siniestro 1983404 (texto coloquial y cortado).
const HECHOS = "durante las lluvias comenzó a evidenciarse el ingreso de agua mediante goteo, generándose posteriormente humedad en el cielo del quincho de la vivienda. Esta situación también se habría presentado en el cielo de la logia.";

describe("léxico pericial", () => {
  it("traduce lo coloquial a término técnico con su descripción, de lo leve a lo grave", () => {
    const quincho = vinetaDeDano({ recinto: "Quincho", descripcion: "Filtración y escurrimiento de agua Escurrimiento de", tipoDano: "" }, HECHOS);
    expect(quincho).toMatch(/^Se observa huella de filtración en cielo \(mácula oscura por ingreso de agua en el entrepiso\), con escurrimiento \(/);
    const dormitorio = vinetaDeDano({ recinto: "Dormitorio 1", descripcion: "Muro inflado por filtración y Muro Inflado", tipoDano: "" });
    expect(dormitorio).toBe("Se observa huella de filtración en muro (mácula de humedad en el muro), con inflamiento de pintura (levantamiento de la capa de pintura por humedad subyacente), según consta en el acta de inspección.");
  });
  it("si el acta no dice en qué elemento está el daño ni lo dicen los hechos, no lo inventa", () => {
    const v = vinetaDeDano({ recinto: "Walking Closet", descripcion: "Humedad y manchas de hongo por", tipoDano: "Manchado" });
    expect(v).toMatch(/superficie/);
    expect(v).toMatch(/colonización fúngica/);
    expect(v).not.toMatch(/cielo|muro|piso/);
  });
  it("la unión abierta junto a un vano es una grieta en junta entre marco y paramento", () => {
    expect(vinetaDeDano({ recinto: "Dormitorio 5", descripcion: "Union abierta entre el vano y Escurrimiento de", tipoDano: "" })).toMatch(/^Se observa grieta en junta entre marco y paramento \(apertura en el sellado entre el cerco y el muro\)/);
  });
  it("no atribuye material ni estado que el texto no menciona", () => {
    expect(manifestaciones("Cubierta rota", "cubierta").map((m) => m.numero)).toEqual([1001]); // genérico, no «policarbonato»
    expect(manifestaciones("Cubierta de policarbonato rota", "cubierta").map((m) => m.numero)).toEqual([5]);
    expect(descripcionPericial("Cielo con humedad")).not.toMatch(/secado|goteo activo/);
  });
  it("sin manifestación sustentada devuelve null y la viñeta queda en su redacción simple", () => {
    expect(descripcionPericial("Cielo Madera Machihembrada")).toBeNull();
  });
  it("el glosario y la jerarquía de severidad llegan a la IA", () => {
    expect(GLOSARIO.length).toBeGreaterThan(90);
    expect(glosarioParaPrompt()).toMatch(/huella de filtración = mácula oscura por ingreso de agua/);
    expect(SYSTEM_NARRATIVA).toContain("GLOSARIO PERICIAL");
    expect(SYSTEM_NARRATIVA).toContain(SEVERIDAD[0]);
    expect(SYSTEM_NARRATIVA).toMatch(/sin atribuir causa|no atribuyas causa/);
  });
});
