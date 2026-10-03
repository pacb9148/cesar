import { redirect } from "next/navigation";
import { hayUsuarios, usuarioActual } from "@/lib/auth";
import FormLogin from "./FormLogin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Login() {
  let primerUso = false;
  let actual = null;
  try {
    actual = await usuarioActual();
    primerUso = !(await hayUsuarios());
  } catch {
    // Sin base de datos la app no puede iniciar sesión: se explica en vez de mostrar un error genérico.
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <h1 className="mb-2 text-2xl font-bold">Ajustador de Siniestros</h1>
        <p role="alert" className="aviso aviso-error">
          No se pudo conectar a la base de datos. El administrador puede ver el detalle en <code>/api/salud</code>.
        </p>
      </main>
    );
  }
  if (actual) redirect("/casos");
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
