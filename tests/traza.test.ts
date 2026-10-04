import { describe, it, expect } from "vitest";
import { respuestaFlujo } from "../lib/api-flujo";
import { emitir, vistaPrevia } from "../lib/traza";

const lineas = async (r: Response) => (await r.text()).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

describe("registro de actividad en vivo", () => {
  it("emite cada paso, en orden, y termina con el resultado", async () => {
    const l = await lineas(respuestaFlujo(async () => {
      emitir("info", "uno", "primero");
      await new Promise((r) => setTimeout(r, 5));
      emitir("ok", "dos", "segundo", "detalle");
      return { listo: true };
    }));
    expect(l.map((x) => (x.traza as { paso?: string } | undefined)?.paso ?? "fin")).toEqual(["uno", "dos", "fin"]);
    expect(l[2]).toEqual({ fin: { listo: true } });
  });
  it("un fallo llega como evento de error y como «falla»", async () => {
    const l = await lineas(respuestaFlujo(async () => {
      emitir("info", "a", "x");
      throw new Error("se rompió");
    }));
    expect(l.at(-1)).toEqual({ falla: "se rompió" });
    expect((l.at(-2)?.traza as { tipo: string }).tipo).toBe("error");
  });
  it("emitir sin nadie escuchando no hace nada", () => {
    expect(() => emitir("info", "x", "y")).not.toThrow();
  });
  it("la vista previa recorta textos largos y oculta imágenes en base64", () => {
    const v = vistaPrevia({ prompt: "a".repeat(500), img: `data:image/jpeg;base64,${"A".repeat(5000)}`, lista: [1, 2, 3, 4, 5, 6] }) as Record<string, unknown>;
    expect(String(v.prompt)).toContain("500 caracteres");
    expect(String(v.img)).toMatch(/datos binarios/);
    expect((v.lista as unknown[]).length).toBe(5);
  });
});
