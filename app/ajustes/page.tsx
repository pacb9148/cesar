import { exigirUsuario } from "@/lib/auth";
import { listarProveedores, MAX_PROVEEDORES } from "@/lib/ia/repo-proveedores";
import { PRESETS, TIPOS } from "@/lib/ia/proveedores";
import Cabecera from "@/components/Cabecera";
import GestorIA from "./GestorIA";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Ajustes() {
  const u = await exigirUsuario();
  const proveedores = await listarProveedores(u.id);
  const tipos = TIPOS.map((t) => ({ id: t, etiqueta: PRESETS[t].etiqueta, ayuda: PRESETS[t].ayuda, pideUrl: PRESETS[t].baseUrl === null && PRESETS[t].familia !== "gemini", urlAuto: PRESETS[t].baseUrl, sinUrl: PRESETS[t].familia === "gemini" }));
  return (
    <>
      <Cabecera nombre={u.nombre} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Ajustes de IA</h1>
        <p className="texto-suave mb-6 text-sm">
          Trae tus propias claves (BYOK) de cualquier proveedor: Gemini, Claude (Opus, Sonnet, Haiku), OpenAI, OpenRouter, NVIDIA o cualquier servicio compatible con OpenAI.
          Cada una se guarda cifrada y se prueba al agregarla; solo entra en servicio si la prueba sale bien. Si un proveedor deja de responder, el sistema salta solo al siguiente por orden de prioridad.
        </p>
        <GestorIA inicial={proveedores} tipos={tipos} max={MAX_PROVEEDORES} />
      </main>
    </>
  );
}
