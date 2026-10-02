import { describe, it, expect } from "vitest";
import { globSync } from "node:fs";
import { leerPlanilla } from "../lib/extraccion/planilla";
import { totalesReclamacion, calcularTotales } from "../lib/engine/totales";
import { hashReclamacion } from "../lib/engine/hash";

const buscar = (p: string) => globSync(`fuente/${p}`)[0];

const CASOS = [
  { id: "1981023", archivo: "1981023*/1981023 Ajuste v1.xlsx", ufRec: 208.17, ufAj: 46.73 },
  { id: "1984673", archivo: "1984673*/1984673 Ajuste V1.xlsx", ufRec: 286.49, ufAj: 27.41 },
];

describe("motor vs planillas emitidas", () => {
  for (const c of CASOS) {
    it(`caso ${c.id}: el motor reproduce UF de reclamación y de ajuste`, async () => {
      const p = await leerPlanilla(buscar(c.archivo));
      const uf = p.valorUF!;
      const rec = totalesReclamacion(p.reclamacion, uf);
      expect(rec.uf).toBeCloseTo(c.ufRec, 1);
      const aj = calcularTotales(
        [...p.decisiones.map((d) => ({ cantidad: d.cantidad, pu: d.pu })), ...p.adicionales],
        { ggPct: p.reclamacion.ggPct, utilidadPct: p.reclamacion.utilidadPct, ivaPct: p.reclamacion.ivaPct, valorUF: uf },
      );
      expect(aj.uf).toBeCloseTo(c.ufAj, 1);
      expect(hashReclamacion(p.reclamacion)).toHaveLength(64);
    });
  }
});
