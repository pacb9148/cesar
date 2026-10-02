import { redirect } from "next/navigation";
import { hayUsuarios, usuarioActual } from "@/lib/auth";
import FormLogin from "./FormLogin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Login() {
  if (await usuarioActual()) redirect("/casos");
  const primerUso = !(await hayUsuarios());
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">Ajustador de Siniestros</h1>
      <p className="texto-suave mb-6">
        {primerUso ? "Primer uso: crea la cuenta de administrador." : "Ingresa con tu cuenta de liquidador."}
      </p>
      <FormLogin primerUso={primerUso} />
    </main>
  );
}
