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
