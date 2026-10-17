import { conUsuario, fallo, json } from "@/lib/api";
import { clasificarArchivo } from "@/lib/caso/clasificar";
import { expandirZip, MAX_BYTES_ZIP } from "@/lib/caso/zip-entrada";
import { auditar, guardarArchivo, listarArchivos, obtenerCaso } from "@/lib/caso/repositorio";

export const maxDuration = 300;
export const runtime = "nodejs";

const MAX_BYTES = 30 * 1024 * 1024;
const PERMITIDOS = /\.(pdf|docx?|xlsx?|jpe?g|png|webp)$/i;

export const GET = conUsuario<{ id: string }>(async (_req, u, { id }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  return json(await listarArchivos(id));
});

/** Recibe archivos sueltos o una carpeta completa (con sus rutas relativas). */
export const POST = conUsuario<{ id: string }>(async (req, u, { id }) => {
  if (!(await obtenerCaso(id, u.id))) return fallo("Caso no encontrado", 404);
  const form = await req.formData();
  const recibidos = form.getAll("archivos").filter((x): x is File => x instanceof File);
  const rutasForm = form.getAll("rutas").map(String);
  if (!recibidos.length) return fallo("No llegó ningún archivo");
  const aceptados: { nombre: string; tipo: string; recinto: string | null }[] = [];
  const rechazados: { nombre: string; motivo: string }[] = [];
  // Un ZIP se abre aquí mismo: cada archivo de su interior entra como si se hubiera subido suelto, con su carpeta como ruta.
  const archivos: File[] = [];
  const rutas: string[] = [];
  for (const [i, f] of recibidos.entries()) {
    if (!/\.zip$/i.test(f.name)) {
      archivos.push(f);
      rutas.push(rutasForm[i] ?? "");
      continue;
    }
    if (f.size > MAX_BYTES_ZIP) {
      rechazados.push({ nombre: f.name, motivo: "supera 150 MB" });
      continue;
    }
    try {
      const z = expandirZip(Buffer.from(await f.arrayBuffer()));
      rechazados.push(...z.omitidos);
      for (const e of z.entradas) {
        archivos.push(new File([new Uint8Array(e.contenido)], e.nombre, { type: "" }));
        rutas.push(e.ruta);
      }
    } catch (e) {
      rechazados.push({ nombre: f.name, motivo: e instanceof Error ? e.message : "ZIP inválido" });
    }
  }
  let orden = 0;
  for (const [i, f] of archivos.entries()) {
    if (!PERMITIDOS.test(f.name)) {
      rechazados.push({ nombre: f.name, motivo: "tipo no admitido" });
      continue;
    }
    if (f.size > MAX_BYTES) {
      rechazados.push({ nombre: f.name, motivo: "supera 30 MB" });
      continue;
    }
    const c = clasificarArchivo(f.name, rutas[i] || null, f.type);
    // Los .doc/.docx sueltos de correspondencia no aportan datos: se guardan igual como "otro".
    await guardarArchivo({ casoId: id, nombre: f.name, tipo: c.tipo, mime: f.type || "application/octet-stream", recinto: c.recinto, orden: orden++, contenido: Buffer.from(await f.arrayBuffer()) });
    aceptados.push({ nombre: f.name, tipo: c.tipo, recinto: c.recinto });
  }
  await auditar(u.id, id, "archivos.subir", { aceptados: aceptados.length, rechazados: rechazados.length });
  return json({ aceptados: aceptados.length, rechazados });
});
