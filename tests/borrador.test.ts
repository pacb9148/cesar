import { describe, it, expect } from "vitest";
import { globSync } from "node:fs";
import mammoth from "mammoth";
import { parsearBorrador } from "../lib/extraccion/borrador";
import { clasificarArchivo } from "../lib/caso/clasificar";
import { construirDatosCaso } from "../lib/caso/procesar";

describe("borrador del informe: reemplaza a la Provisión", () => {
  it("lee póliza, vigencia, suma asegurada, fechas, partes y denuncia del Word del caso 1", async () => {
    const f = globSync("fuente/1981023*/1981023 Informe borrador.docx")[0];
    const b = parsearBorrador((await mammoth.extractRawText({ path: f })).value);
    expect(b).toMatchObject({ liquidacion: "170448", siniestro: "1981023", polizaNumero: "20580183", polizaItem: "4", vigenciaDesde: "01/10/2024", vigenciaHasta: "30/09/2026", sumaAseguradaUF: 1294, deducibleUF: 0, fechaOcurrencia: "16/07/2026", fechaAsignacion: "29/07/2026", fechaDenuncia: "29/07/2026", fechaInspeccion: "07/08/2026", fechaEmision: "20/08/2026" });
    expect(b.asegurado).toMatchObject({ nombre: "Juan Antonio Riquelme Munoz", rut: "17.897.486-6" });
    expect(b.beneficiario.rut).toBe("97.030.000-7");
    expect(b.denunciaTexto).toMatch(/^Producto del riesgo de la naturaleza/);
  });
  it("un texto sin los campos no falla: todo queda en null", () => {
    const b = parsearBorrador("Hola\n\nSolo esto");
    expect([b.polizaNumero, b.sumaAseguradaUF, b.fechaOcurrencia, b.denunciaTexto]).toEqual([null, null, null, null]);
  });
  it("se reconoce por el nombre y sin la Provisión no se pide ningún dato adicional", () => {
    expect(clasificarArchivo("1992286 Informe borrador.docx", null, "application/vnd.openxmlformats-officedocument.wordprocessingml.document").tipo).toBe("borrador");
    expect(clasificarArchivo("INSP.-15297.pdf", null, "application/pdf").tipo).toBe("acta");
    const { alertas } = construirDatosCaso({ siniestro: "1992286", asegurado: "Rocio Fornes", fechaSiniestro: "16-07-2026", danos: [] } as never, null, {}, true);
    expect(alertas.filter((a) => /Provisi|póliza|vigencia|suma asegurada|asignación|Falta/i.test(a))).toEqual([]);
  });
});
