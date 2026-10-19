import { describe, it, expect } from "vitest";
import { numeroChileno, UF_MAX, UF_MIN } from "../lib/domain/numero";

describe("número escrito por una persona", () => {
  it("lee coma decimal chilena, punto decimal y puntos de miles sin mezclarlos", () => {
    expect(numeroChileno("40.844,79")).toBe(40844.79);
    expect(numeroChileno("40844,79")).toBe(40844.79);
    expect(numeroChileno("40844.79")).toBe(40844.79); // nunca 4.084.479
    expect(numeroChileno("40.844")).toBe(40844);
    expect(numeroChileno(" 1.234.567 ")).toBe(1234567);
    expect(numeroChileno("38000")).toBe(38000);
  });
  it("rechaza lo que no es un número", () => {
    for (const t of ["", "abc", "40,844.79", "12,3,4", "$40.844", "1..000"]) expect(numeroChileno(t)).toBeNull();
  });
  it("el rango de la UF deja fuera los errores de tipeo", () => {
    expect(40844.79).toBeGreaterThan(UF_MIN);
    expect(40844.79).toBeLessThan(UF_MAX);
    expect(4084479).toBeGreaterThan(UF_MAX);
  });
});
