import { exigirUsuario } from "@/lib/auth";
import { estadoCredencial } from "@/lib/ia/credenciales";
import Cabecera from "@/components/Cabecera";
import FormIA from "./FormIA";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Ajustes() {
  const u = await exigirUsuario();
  const estado = await estadoCredencial(u.id);
  return (
    <>
      <Cabecera nombre={u.nombre} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Ajustes de IA</h1>
        <p className="texto-suave mb-6 text-sm">
          Usa tu propia clave de Google AI Studio (BYOK). Se guarda cifrada en el servidor y nunca vuelve a mostrarse: solo verás sus últimos 4 caracteres.
          Las llamadas al modelo se hacen con tu clave y se facturan en tu cuenta de Google.
        </p>
        <FormIA inicial={estado} />
      </main>
    </>
  );
}
