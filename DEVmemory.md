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

## Timeouts a todos los proveedores en producción (04/10/2026)
- **Síntoma:** en el servidor, todo proveedor daba «Sin respuesta del proveedor: The operation was aborted due to timeout» aunque la clave funcionaba en el panel del proveedor; en local funcionaba. La base guardaba ese error y el log mostraba el aborto a los 120 s (el tiempo total), no un error de conexión.
- **Causa más probable:** el paquete `undici` instalado exige Node ≥ 22.19 (`engines`) y el servidor construye con Nixpacks y Node 22 (`NIXPACKS_NODE_VERSION=22`), sin garantía de esa versión. Se sustituyó por `node:https` con `lookup` propio, que es estable en cualquier Node 20+. **Pendiente de confirmar en producción** tras el despliegue (`/api/salud?red=1`).
- **Regla:** al mezclar una dependencia con `engines` de Node más reciente, comparar con la versión real del servidor (`process.version`); lo crítico (red, cifrado) con módulos nativos de Node. Y poner tiempos máximos cortos a lo que solo prueba una conexión.
- La batería de seguridad separa ahora las vulnerabilidades de producción (bloquean) de las de herramientas de desarrollo sin parche publicado (`braces` dentro del linter; se informan como aviso).

## Segundo fallo con NVIDIA: «Sin respuesta del proveedor en 60 s» (04/10/2026)
- Tras corregir la red (Node 22.11 en el servidor, `undici` fuera) los modelos razonadores de NVIDIA (`openai/gpt-oss-20b`, `deepseek-ai/deepseek-v4.1-flash`) seguían sin responder en la prueba, mientras la plataforma de referencia (otro proyecto del equipo) los daba por buenos con «200 OK». Esa plataforma hace una petición de chat plana: `max_tokens: 1000`, `temperature` 0.3, sin `response_format`.
- **Causa más probable:** mi prueba mandaba el modo JSON estricto y ningún tope de salida; con modelos razonadores eso deja la petición esperando (el servidor había conectado: no era un fallo de red). Corrección: la prueba es una petición simple (ping) igual a la de referencia; el modo JSON solo con los proveedores donde es fiable; siempre un tope de salida con escala descendente. **Sin confirmar con la clave real** (no se puede probar desde aquí).
- **Regla:** cuando algo funciona en otra plataforma y no en la nuestra, reproducir **la petición exacta que ya funciona** (cuerpo, parámetros) antes de suponer un problema de red, y que la prueba de conexión sea lo más simple posible (el formato avanzado se valida al usar).

## Anthropic: «credit balance is too low» con la prueba en verde (04/10/2026)
- La prueba (`ping`, `max_tokens: 20`) pasaba, pero el ajuste real (`max_tokens: 16000`, imágenes) recibía 400 «credit balance is too low». Es facturación de la cuenta de Anthropic, no un fallo del sistema: una prueba corta no detecta saldo justo.
- `clasificarFallo` reconoce la falta de saldo (`esFaltaDeSaldo`: 402, «credit balance», «insufficient_quota»…) y lo explica como tal; `ClienteAnthropic` baja el tope de salida (16000→8192→4096) también ante ese 400, por si el saldo alcanza para un tope menor.
- Para el usuario: recargar en Plans & Billing de Anthropic, o agregar otro proveedor (la rotación salta solo).

## 404 al probar modelos de NVIDIA bajo «Google Gemini» (04/10/2026)
- Causa: el proveedor elegido era Google Gemini con una clave `nvapi-…` y el modelo `google/gemma-4-31b-it` (id del catálogo de NVIDIA). Gemini no conoce ese modelo → 404. Los modelos de Google/otras marcas servidos por NVIDIA se agregan con proveedor **NVIDIA**.
- `incoherencia()` (proveedores.ts) detecta clave con prefijo de otro proveedor (`nvapi-`, `sk-ant-`, `sk-or-`, `AIza`) y modelos «marca/nombre» bajo Gemini/Anthropic; se aplica al agregar (se rechaza sin guardar) y al probar uno ya guardado, con el motivo en claro.

## NVIDIA: URL del endpoint visible y editable (04/10/2026)
- La URL de NVIDIA (`https://integrate.api.nvidia.com/v1`) ya era automática, pero el formulario no la mostraba y parecía que faltaba. Ahora todo proveedor (salvo Gemini) tiene el campo «URL del endpoint (opcional)» con la automática como ayuda; si se escribe una, manda sobre la del preset, y se admite pegar la URL de invocación completa (`…/chat/completions` o `…/messages` se recortan). Sigue pasando por `validarBaseUrl` (https, sin IP privada) y la guarda de DNS.
- `fetchSeguro` envía `User-Agent` (algunos WAF cuelgan peticiones de Node sin él: hipótesis, no confirmada) y los errores de tiempo agotado incluyen las IP a las que resolvió el destino, para distinguir red/IPv6 de modelo lento en el próximo informe.
- Sigue sin confirmarse en producción la respuesta de NVIDIA: desde el servidor solo se probó con claves falsas en local.

## Registro de actividad en vivo en cada paso (04/10/2026)
- Pedido: ver qué hace la aplicación y cómo, y dónde deja de funcionar el modelo. Se implementó un **registro de actividad en vivo**: `lib/traza.ts` (AsyncLocalStorage en `globalThis`; `emitir()` desde cualquier capa, sin pasar parámetros y sin efecto si nadie escucha) y `lib/api-flujo.ts` (respuesta NDJSON: un evento por línea, y al final `fin` o `falla`). En el cliente, `useFlujo` + `PanelTraza` (con «Copiar registro» para pegarlo en un informe de error).
- Cubren: lectura de documentos (acta, provisión, presupuesto, UF), ajuste (datos, fotos, proveedor elegido, cada intento del modelo, validación), generación del informe y el nuevo **«Diagnóstico paso a paso»** de cada proveedor (`/api/ajustes/ia/[id]/diagnostico`: prueba simple + prueba por la ruta del agente).
- `fetchSeguro` informa cada fase de red (DNS con IP, TCP, TLS, petición enviada con tamaño, cabeceras de respuesta, cuerpo) y avisa cada 10 s mientras espera, con un resumen del cuerpo enviado (imágenes ocultas, textos recortados; nunca cabeceras ni claves).
- **Vista previa del ajuste** (`GET /api/casos/[id]/ajustar`): partidas, recintos, fotos y KB, tamaño de instrucciones/datos/esquema, tokens estimados y proveedores en orden, sin llamar a la IA.
- Corrección de fondo: las llamadas usan un `Agent` sin reutilización de conexiones (`keepAlive: false`): un socket ya cerrado por el proveedor dejaba la petición colgada sin error.
- Contraste del panel medido en claro (mín. 5,65:1) y oscuro (mín. 7,34:1). Prueba `rotacion` con Postgres embebido era intermitente con la máquina cargada: `hookTimeout` subido.
- Regla general: una operación larga que habla con terceros debe mostrar sus fases en vivo desde el primer día; sin eso, «no responde» no se puede diagnosticar.
