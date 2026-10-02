# Estado de la aplicación y guía de despliegue

> Actualizado 03/10/2026. Complementa `01` (análisis), `02` (plan) y `03` (prompt maestro).

## Qué está construido y verificado

| Pieza | Estado | Evidencia |
|---|---|---|
| Lectura de **acta** y **provisión** (parsers deterministas, sin IA) | Hecho | `tests/acta.test.ts`: los 4 casos |
| Lectura del **presupuesto** (Excel y PDF) con validación aritmética | Hecho | `tests/presupuesto.test.ts`: $5.716.010 · $8.060.090 · $5.147.340 al peso; el PDF del caso 4 con la línea de cubierta «pegada» también cuadra |
| **Motor** (cubicación, baremo de 399 partidas, totales, UF, hash de la reclamación) | Hecho | Reproduce UF 208,17 → 46,73 (caso 1) y 286,49 → 27,41 (caso 3) |
| **Excel** de ajuste con el formato de la planilla emitida (fórmulas vivas, leyenda A–F) | Hecho | Ida y vuelta: lo generado se vuelve a leer con los mismos totales |
| **Informe Word** sobre la plantilla real (cabeceras, logo, portada, fotos, cuadro, INIA, marcadores `[FALTA DATO]`) | Hecho | Abierto con Word (14 páginas), comparado página a página con el informe final del caso 1 |
| **Anexo de fotografías** (portada + 2×2 por recinto) | Hecho | Abierto con Word |
| **Captura de agrometeorologia.cl** (estación más cercana, valores, tooltip del día) | Hecho | Temuco → Aeródromo Maquehue 4,3 mm / 58,7 km/h (su imagen); Concepción → Carriel Sur 39,2 mm / 110,5 km/h (informe final) |
| **Agente de ajuste** (prompt, esquema, validadores, reintentos con los errores) | Hecho, **sin llamada real a Gemini** | Probado con un cliente simulado que repite la planilla emitida |
| **App web** (login, casos, 4 pasos, edición del ajuste, descargas) | Hecho | Recorrida en el navegador, contraste WCAG medido en claro y oscuro: 0 fallos |
| Punta a punta con los 4 casos (subir carpeta → leer → ajustar → generar) | Hecho con ajuste de referencia | UF final: caso 1 **46,73**, caso 2 **26,49** (pérdida determinada), caso 3 **27,41**, caso 4 **40,44** |
| Batería de seguridad del proyecto | Aprobada | 0 secretos, 0 vulnerabilidades altas/críticas (2 moderadas: `uuid` dentro de `exceljs`) |

## Lo que NO está probado

1. **Gemini real.** Falta `GEMINI_API_KEY` en `.env.local`. El ajuste de los casos de prueba entró por la ruta manual (planilla emitida). La primera ejecución real puede necesitar afinar el prompt; cada intento queda en `llm_runs`.
2. **Base de datos de runwebx.com.** Desde este equipo el puerto 5432 no responde (`runwebx.com:5432` cerrado; el 443 sí). Todo se probó con **PGlite** (Postgres embebido con las mismas migraciones). El camino `pg` está escrito pero no se ejecutó contra su servidor.
3. **PDF idéntico al Word.** Usa LibreOffice si está instalado (lo trae el `Dockerfile`). Aquí no lo hay, así que los PDF de prueba salieron con el conversor de respaldo (contenido e imágenes sí, formato no exacto). La app avisa cuando pasa.
4. **El `Dockerfile`** no se construyó (no hay Docker en este equipo).
5. **Caso con mandato escaneado:** el mandato no se lee ni se necesita para el informe; no hay OCR implementado.

## Decisiones que cambiaron respecto al plan

| Tema | Plan | Realidad |
|---|---|---|
| Base de datos | Supabase con su cliente y Storage | Postgres directo con `pg`: solo se dispone de una URL de conexión del tenant (sin claves de API). Archivos en `bytea`; sesiones y usuarios propios (`scrypt`, cookie `httpOnly`) |
| Schema | `public` | El propio del tenant (`DB_SCHEMA`), sin prefijo `public.` en el SQL |
| Excel «vía Python» | `openpyxl` en un worker | `ExcelJS` en Node: mantiene un solo servicio y el formato sale de la propia planilla emitida |
| Worker aparte | Sí | No hace falta: Coolify corre un contenedor con Chromium y LibreOffice |
| Despliegue | Vercel | Coolify (`runwebx.com`), por el webhook que hay en `.env.local`. En Vercel faltaría LibreOffice |

## Cómo se ejecuta

```bash
npm install
# Local sin acceso a la red de la base: Postgres embebido en .pglite/
DB_MODE=pglite npm run dev
# Pruebas (necesitan la carpeta fuente/ con los casos)
npm test
# Prueba de punta a punta con el servidor ya levantado en :3010
DB_MODE=pglite npx next start -p 3010   # en otra terminal
npx tsx scripts/e2e.mts 1981023
```

## Variables de entorno (`.env.local` local, panel de Coolify en producción)

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión Postgres del tenant (ya derivada en `.env.local`) |
| `DB_SCHEMA` | Schema del tenant (ya derivada) |
| `GEMINI_API_KEY` | **Falta.** Google AI Studio |
| `GEMINI_MODEL` | Identificador del modelo; hoy `gemini-2.5-pro`. Verificar el vigente |
| `CHROME_PATH`, `SOFFICE_PATH` | Navegador y LibreOffice (el `Dockerfile` ya los define) |
| `DB_MODE=pglite` | Solo desarrollo sin red a la base |

## Despliegue en Coolify (cuando usted lo ordene)

1. Crear la aplicación desde el repositorio con *Build Pack: Dockerfile*, puerto 3000.
2. Cargar `DATABASE_URL`, `DB_SCHEMA`, `GEMINI_API_KEY`, `GEMINI_MODEL`. **Las variables van como «solo ejecución» (Build time: no disponible)**.
3. El servidor aplica las migraciones al arrancar (`instrumentation.ts`, con bloqueo asesor).
4. Primer ingreso: la pantalla de login pide crear el administrador. Después el registro queda cerrado; solo un admin crea usuarios.
5. Cada `git push` a la rama configurada **redespliega automáticamente** por el webhook: por eso no se ha hecho ningún push.

## Pendientes recomendados

- Poner la `GEMINI_API_KEY` y correr el ajuste real sobre los casos 1 a 3; comparar con las planillas emitidas. El caso 4 se reserva como examen ciego.
- Pantalla para crear usuarios adicionales (hoy solo vía API `/api/auth/registro` con sesión de admin).
- OCR con visión para PDF escaneados (presupuestos sin texto).
- Panel de baremo editable y precios de mercado con fuente.
- `exceljs` arrastra `uuid` con una vulnerabilidad moderada: revisar al actualizar la librería.
