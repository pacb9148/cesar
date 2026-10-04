# DEVmemory — Ajustador de Siniestros (cesar)

## Qué es
App web (Next.js 16 + Tailwind 4 + PostgreSQL) donde un liquidador sube la carpeta de un siniestro y obtiene el ajuste de pérdida: Excel, informe Word/PDF y anexo de fotos. IA: Gemini, con reglas de oro del dueño.

## Arquitectura en una línea
`lib/extraccion` (parsers deterministas) → `lib/ia` (agente + validadores) → `lib/engine` (cubicación, baremo, totales; **el modelo nunca calcula**) → `lib/docs` (Excel, Word sobre plantilla real, cuadro PNG, PDF, anexo) → `lib/caso` (orquestación) → `app/` (UI y API).

## Aprendizajes (reglas, no anécdotas)
- **Un PDF no se lee en el orden que entrega `getTextContent`**: en tablas deja las etiquetas lejos de los importes. Reconstruir líneas por posición (Y/X). Sin eso, el resumen del presupuesto salía vacío.
- **Los reemplazos de texto en Word se hacen sobre el párrafo completo**, no por run: Word parte las palabras en runs. Al reemplazar varias coincidencias de un párrafo en orden inverso, hay que actualizar el texto vigente de cada nodo tras dividir un run (si no, se duplica texto).
- **Una plantilla generada desde un caso real arrastra datos de ese caso** (fotos de fachada en VML, un gráfico EMF, el texto de la denuncia). Verificar con una búsqueda de residuos y retirar los medios huérfanos y sus relaciones.
- **La reclamación se transcribe sin redondear**: con los decimales exactos reproduce el total del contratista al peso; con los redondeados de la planilla manual hay +$135.
- **Páginas y rutas de Next cargan módulos en grafos distintos**: un singleton de conexión (PGlite) debe vivir en `globalThis`, o aparecen dos bases en memoria.
- **El selector de estación meteorológica se resuelve por distancia** (geocodificar con respaldo progresivo; la calle exacta suele no estar en OSM). Con eso se reproducen las estaciones que eligieron los peritos.
- **Playwright: tras `form.submit()` hay que esperar la navegación** antes de leer el DOM; si no, se lee la página anterior.
- **`next start` con `output: standalone`** avisa pero funciona; en producción `node server.js`.
- **Base del tenant (runwebx.com):** el 5432 no es alcanzable desde fuera de su red. Desarrollar con PGlite y las mismas migraciones.

## Decisiones
Ver `docs/04-estado-y-despliegue.md` (qué cambió frente al plan y por qué).

## Verificado el 03/10/2026
15 pruebas en verde; build y typecheck limpios; 4 casos de punta a punta (UF 46,73 · 26,49 · 27,41 · 40,44); contraste claro/oscuro sin fallos; batería de seguridad aprobada.

## Despliegue en Coolify (03/10/2026)
- **Primer despliegue fallido: `Remote branch main not found in upstream origin`.** El repositorio de GitHub estaba vacío y la rama local se llamaba `master`; Coolify clona `main`. Regla: `git init -b main` y verificar con `git ls-remote` que la rama existe antes de redesplegar.
- «No autenticado» en el panel RunWebX era la sesión caducada, no el repositorio.
- RunSup muestra «No hay tablas visibles» hasta que la app arranca y aplica las migraciones (`instrumentation.ts`) en el schema del tenant.
- Variables de entorno de producción (solo ejecución): `DATABASE_URL`, `DB_SCHEMA`, `GEMINI_API_KEY`, `GEMINI_MODEL`.
- **Bucle de login sin error en producción (04/10/2026):** la cookie de sesión iba con `Secure` por `NODE_ENV=production`, pero la app se sirve por `http://…sslip.io`; el navegador descarta en silencio una cookie `Secure` recibida por http. La base mostraba sesiones creadas (4 para 1 usuario) y el usuario seguía en el formulario. Regla: `Secure` según `x-forwarded-proto`, no según `NODE_ENV`. Diagnóstico: contar filas de `sesiones` con `db sql` (si crecen, el servidor acepta el login y falla el navegador).
- **Conexión a RunSup:** desde la red de los contenedores el host es interno (`10.10.0.1:5432`, `sslmode=disable`); `runwebx.com:5432` no es alcanzable. `node .runwebx/runwebx.mjs conexion probar` lo comprueba y `logs`, `despliegues log`, `db sql` dan el diagnóstico sin pedir capturas.

## BYOK abierto y rotación (04/10/2026)
- **Mezclar el `fetch` integrado de Node con el `Agent` del paquete `undici` instalado falla** (`invalid onRequestStart method`): son versiones distintas. Usar `fetch` y `Agent` del mismo paquete. Lo cazó una llamada real a un proveedor; los tests con respuestas simuladas no lo veían.
- **Una URL base que escribe el usuario es un SSRF** en un servidor que comparte red con la base de datos: validar la forma, bloquear rangos privados/metadatos y fijar la IP resuelta al conectar (un `lookup` propio), sin redirecciones.
- **Gemini responde 400, no 401, a una clave inválida**: clasificar por el texto además del código, o la rotación la trataría como un error de petición y volvería a intentarla.
- **Las rutas de Next solo pueden exportar manejadores**: los esquemas compartidos van a un módulo aparte.
- **Probar contra la red real tras la prueba unitaria**: la API respondió distinto a lo supuesto (modelo retirado con 410, mensaje con la clave enmascarada).
