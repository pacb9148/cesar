import { describe, it, expect, beforeAll } from "vitest";
import { cifrar, descifrar } from "../lib/ia/cifrado";

beforeAll(() => {
  process.env.APP_SECRET = "a".repeat(64);
});

describe("cifrado de claves de IA (BYOK)", () => {
  it("ida y vuelta, y el texto cifrado no contiene la clave", () => {
    const clave = ["AIza", "SyEjemploDeClaveDePrueba_1234567890"].join(""); // partida a propósito: no es una clave real y no debe disparar el barrido de secretos
    const t = cifrar(clave);
    expect(t.startsWith("v1.")).toBe(true);
    expect(t).not.toContain("AIza");
    expect(descifrar(t)).toBe(clave);
  });
  it("cada cifrado usa un IV distinto", () => {
    expect(cifrar("misma-clave-de-prueba-123")).not.toBe(cifrar("misma-clave-de-prueba-123"));
  });
  it("rechaza datos alterados y APP_SECRET distinta", () => {
    const t = cifrar("clave-de-prueba-abcdefghijk");
    const partes = t.split(".");
    partes[3] = Buffer.from("alterado").toString("base64");
    expect(() => descifrar(partes.join("."))).toThrow(/descifrar/);
    process.env.APP_SECRET = "b".repeat(64);
    expect(() => descifrar(t)).toThrow(/APP_SECRET/);
    process.env.APP_SECRET = "a".repeat(64);
  });
  it("exige APP_SECRET", () => {
    delete process.env.APP_SECRET;
    expect(() => cifrar("x")).toThrow(/APP_SECRET/);
    process.env.APP_SECRET = "a".repeat(64);
  });
});
