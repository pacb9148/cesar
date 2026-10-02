import { NextResponse } from "next/server";
import { usuarioActual, type Usuario } from "./auth";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fallo = (mensaje: string, status = 400) => NextResponse.json({ error: mensaje }, { status });

type Ctx<P> = { params: Promise<P> };

/** Envuelve un handler: exige sesión y convierte excepciones en JSON legible sin filtrar la traza. */
export function conUsuario<P = Record<string, string>>(fn: (req: Request, u: Usuario, p: P) => Promise<Response>) {
  return async (req: Request, ctx: Ctx<P>) => {
    const u = await usuarioActual();
    if (!u) return fallo("Sesión no iniciada", 401);
    try {
      return await fn(req, u, await ctx.params);
    } catch (e) {
      console.error("[api]", e);
      return fallo(e instanceof Error ? e.message : "Error inesperado", 500);
    }
  };
}
