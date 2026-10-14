import { describe, it, expect } from "vitest";
import { generoPorNombre, numeroFlexible, tratamientoDe } from "../lib/domain/genero";

describe("tratamiento del asegurado por el nombre", () => {
  it("la Sra. / el Sr. según el nombre de pila, y el elegido por el usuario manda", () => {
    expect(tratamientoDe("Rocio Nicole Fornes Jaramillo")).toBe("la Sra.");
    expect(tratamientoDe("Gloria Isolina Veliz Ramos")).toBe("la Sra.");
    expect(tratamientoDe("Maria Jose Soto")).toBe("la Sra.");
    expect(tratamientoDe("Juan Antonio Riquelme Munoz")).toBe("el Sr.");
    expect(tratamientoDe("Jose Maria Perez")).toBe("el Sr.");
    expect(tratamientoDe("Nicolas Vera")).toBe("el Sr.");
    expect(tratamientoDe("Andrea Soto", "m")).toBe("el Sr.");
    expect(generoPorNombre("")).toBeNull();
  });
});

describe("números escritos por una persona", () => {
  it("la UF con punto decimal no se convierte en millones", () => {
    expect(numeroFlexible("40844.79")).toBe(40844.79); // el fallo de 4.084.479
    expect(numeroFlexible("40.844,79")).toBe(40844.79);
    expect(numeroFlexible("40844,79")).toBe(40844.79);
    expect(numeroFlexible("1.294")).toBe(1294);
    expect(numeroFlexible("1294,50")).toBe(1294.5);
  });
});
