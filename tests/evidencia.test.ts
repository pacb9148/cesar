import { describe, it, expect } from "vitest";
import { redactarEvidencia } from "../lib/caso/evidencia-parrafo";

const ev = (recinto: string, vineta: string, m2: number | null = null, atribuible = true) => ({ recinto, vineta, m2_acta: m2, atribuible, fotos: [] });
const auto = (r: string, m2: number, tipo: string) => ev(r, `${r}: ${m2} m² con daño de tipo ${tipo} registrado en el acta de inspección.`, m2);

describe("párrafo de evidencia observada", () => {
  it("agrupa por tipo de daño, sin repetir muletillas, y cierra con el total", () => {
    const t = redactarEvidencia([auto("Cocina", 5, "Manchado"), auto("Living Comedor", 7, "Manchado"), auto("Dormitorio 2", 6, "Manchado"), auto("Patio Trasero", 3, "no clasificado")]);
    expect(t).toBe("Durante la visita de inspección se constataron daños de tipo manchado en cocina (5 m²), living comedor (7 m²) y dormitorio 2 (6 m²), así como daños sin clasificar en patio trasero (3 m²). En total, la superficie afectada registrada en el acta alcanza 21 m².");
    expect(t.match(/registrado en el acta/g)).toBeNull();
    expect(t.match(/Cocina/g)).toBeNull();
  });
  it("conserva el texto libre de la IA sin el prefijo del recinto ni el «m² según acta» final", () => {
    const t = redactarEvidencia([ev("Living", "Living: Cielo de madera machihembrada con manchas por filtración. 7 m² según acta.", 7)]);
    expect(t).toBe("Durante la visita de inspección, en living (7 m²) se observó cielo de madera machihembrada con manchas por filtración.");
  });
  it("separa lo no atribuible al siniestro y un solo recinto no lleva total", () => {
    const t = redactarEvidencia([auto("Cocina", 5, "Manchado"), ev("Cubierta", "desgaste", 4, false)]);
    expect(t).toBe("Durante la visita de inspección se constataron daños de tipo manchado en cocina (5 m²). No se atribuyen al siniestro los daños observados en cubierta.");
  });
  it("sin evidencias devuelve vacío", () => expect(redactarEvidencia([])).toBe(""));
});
