import { z } from "zod";

/** Campos compartidos por las rutas de ajustes de IA (las rutas de Next solo pueden exportar manejadores). */
export const campoClave = z.string().trim().min(8).max(500).regex(/^[\x21-\x7E]+$/, "La clave tiene caracteres no válidos");
export const campoModelo = z.string().trim().min(2).max(120).regex(/^[\w./:@+-]+$/, "Identificador de modelo inválido");
