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

## El modelo clasifica, el motor decide (04/10/2026)
- Evidencia del registro en vivo: (1) con NVIDIA (nemotron-3.5 30B) la petición única de 42 KB con 16000 tokens de salida se quedaba >50 s sin respuesta; (2) con Gemini el JSON gigante (decisiones de 40 partidas + redacción) fallaba el esquema (5 problemas) y dejaba 34 partidas sin decidir. Causa común: se le pedía al modelo demasiado en una sola respuesta, incluidas cifras.
- Nuevo diseño (prompt v0.2): `lib/ia/motor-ajuste.ts` es el motor determinista: contrasta cada partida con el máximo permitido (precio → baremo; cantidad → medición del acta/cubicación/plancha) y ajusta solo si lo reclamado lo excede; nunca sube lo reclamado; absorbida→E cantidad 0, ajena→A, preventiva→D=1, agrupada→desglose en 2 sub-líneas, unidad convertida → manda baremo+medida. El modelo solo **clasifica** (categoría, id de baremo, base de medida, unidad) en **lotes de 10 partidas, 3 a la vez** (peticiones de pocos KB), y luego **redacta** (características, evidencia, texto, resumen, partidas adicionales) con las fotos.
- Tolerancia: lo que el modelo no entrega bien se pide una vez más y, si falta, el motor usa la clasificación por defecto (baremo más parecido, cantidad reclamada) y deja aviso; si la redacción falla, texto automático desde el acta. Un fallo de conexión con todos los proveedores sí se propaga (no se inventa un ajuste sin IA).
- Tope de salida por tarea (`maxSalida`): 8192 al clasificar. Vista previa y pruebas actualizadas (62 verdes). Sin IA el motor solo recorta precios (caso 1: UF 164 vs 46,7 del perito): el recorte fuerte depende de la clasificación del modelo y aún no se midió con un modelo real.

## Estados de partida, desplegables y fotos 7,8 × 6,5 cm (04/10/2026)
- **Ajuste**: cada sección es un desplegable (abiertas por defecto, con «Expandir/Contraer todo» y resumen de estados). Estado por color y etiqueta (no solo color): ámbar = ajustada por la IA, azul = sin tocar (se acepta lo reclamado), verde = ajustada por el usuario (`DecisionLinea.fuente = "usuario"`). Las partidas sin decisión ya no dan «Falta decidir la partida n»: se aceptan como reclamadas (`completarConRespeto` al guardar; `armarFilas` las trata así). Todas las partidas editables muestran cantidad/precio con el valor aceptado y el reclamado como placeholder; `editarDecision` (lib/engine/edicion.ts) marca B/C solas, F es exclusiva y devuelve lo reclamado.
- **Fotos**: informe y anexo usan `tablasDeFotos` (lib/docs/fotos-xml.ts): imágenes de exactamente 7,8 × 6,5 cm (2.808.000 × 2.340.000 EMU), cuadrícula 2 × 3, leyenda de una línea («Recinto: daño según el acta»), recorte con `sharp.strategy.attention` (zona más llamativa). La fachada, si existe, abre la primera tabla como fila de cabecera centrada. El informe lleva solo recintos con daño en el acta (máx. 4 por recinto); el anexo, todas. La tabla «Fachada y numeración» de la plantilla se mantiene.
- Medido: la fila con título + 3 filas cabe en la página (cuerpo útil 22,4 cm); con fachada la tabla pasa de página por filas (no se parten).
- Contraste de los tres estados medido en claro (mín. 5,61:1) y oscuro (mín. 6,55:1). El e2e ahora lee las respuestas en flujo.

## «No se encontró Chrome/Edge» al generar el informe (04/10/2026)
- Causa: producción corre con Nixpacks (sin Chromium ni LibreOffice) y el cuadro de pérdida se dibujaba como imagen con un navegador; sin él, todo el informe fallaba. El CLI de RunWebX solo permite elegir el Build Pack al crear el proyecto: cambiarlo a **Dockerfile** (que ya instala Chromium y LibreOffice) se hace en el panel de RunVer.
- Arreglo en el código para que el informe nunca dependa del navegador: el cuadro cae a **tabla nativa de Word** (`cuadroTablaXml`, editable, con totales y leyenda), la captura meteorológica ya era opcional (ahora lo informa), y si no hay LibreOffice ni Chromium el PDF se omite y se avisa (se entrega Word + Excel + anexo + ZIP). `SIN_NAVEGADOR=1` fuerza ese modo para probarlo. Verificado de punta a punta en el caso 1 sin navegador.

## Lectura por partida con guardado temporal y editor de fotos (06/10/2026)
- **Lectura partida por partida**: el análisis de cada partida del presupuesto es ahora UNA petición propia (`textoDePartida`, ~2–4 KB, 4 a la vez) en vez de lotes de 10. Cada resultado se guarda al llegar en `analisis_partidas` (migración 0005, ligada a la huella `hash de la reclamación:versión del prompt`); si el proveedor se cae a mitad, el error dice cuántas se leyeron y al repetir solo se analizan las pendientes. Al terminar todas se consolidan en un solo ajuste (motor + redacción) y los resultados temporales se borran. Una partida con respuesta inválida (tras 2 intentos) la resuelve el motor con reglas automáticas y queda con aviso. El parser del presupuesto (determinista) ya controla la suma contra el costo directo declarado.
- **Editor de fotos** (`EditorFoto.tsx`, `FotosInforme.tsx` en el paso Informe): marco fijo 7,8 × 6,5 cm sobre el que se arrastra/amplía/gira/voltea la imagen, brillo/contraste/saturación, leyenda de una línea y cuadrícula de guía (columnas, filas, celdas cuadradas, diagonales, etiquetas, color, opacidad, trazo ultrafino de 0,5 px, y modo «mover la cuadrícula»); todos los controles son iconos con etiqueta y tooltip (`components/Iconos.tsx`). Se guardan solo parámetros (`archivos.edicion`, jsonb); `lib/fotos/recorte.ts` es el cálculo compartido entre pantalla y servidor y `aplicarEdicion` (sharp) produce la imagen final que entra en la tabla del informe y del anexo. Si el usuario marca fotos con ✓, van esas; si no, las del área afectada. Miniaturas por `?miniatura=1`.
- Medido: contraste del editor en claro (mín. 6,62:1) y oscuro (mín. 7,34:1); e2e: 3 fotos elegidas + fachada = 4 imágenes de 7,8 × 6,5 cm y leyenda editada en el Word.

## Vista previa editable de Word y Excel (06/10/2026)
- En el paso Informe, cada entregable Word (informe) y Excel tiene «Ver y editar» (`VistaDocumento.tsx`). **Word**: `docxAVista` recorre cuerpo y tablas con un índice estable por párrafo (posición entre todos los `w:p`), el navegador lo pinta como hoja (negritas, versalitas, imágenes, tablas) y cada párrafo sin imágenes es editable; `aplicarTextos` cambia solo los párrafos modificados (conserva el formato de su primer tramo de texto; los párrafos con imágenes no se tocan). **Excel**: `libroAVista` muestra las hojas con formato, combinadas y fórmulas marcadas; se editan las celdas constantes (las de fórmula no se pisan) y `aplicarCeldas` recalcula.
- El recálculo usa un evaluador propio sin eval (`formulas.ts`: + − × ÷ ^, paréntesis, referencias y rangos entre hojas, SUM/ROUND/MIN/MAX/ABS/AVERAGE); lo que no entiende conserva su valor. Hallazgo: ExcelJS descarta un resultado `0` en fórmulas (queda como vacío), por eso un 0 calculado sobre una celda sin valor no cuenta como cambio y la vista muestra 0.
- Guardar reemplaza el propio entregable, rehace el PDF del informe (si hay LibreOffice/Chromium; si no, avisa de que conserva el anterior) y el ZIP. «Volver a generar» descarta estas ediciones. Los cambios del Excel no modifican el Word (se corrigen aparte en su vista).
- Verificado en el navegador con el caso 1: editar «Ubicación» en el Word y guardar lo dejó en el documento; cambiar la cantidad de la partida 1.1 a 5 en el Excel dio total 62.400 y el valor a indemnizar bajó de UF 46,73 a 42,23. Aprendizaje: el servidor `standalone` necesita copiar `.next/static` y `public` para probarlo en el navegador.

## LibreOffice local y edición completa de documentos (06/10/2026)
- Instalado LibreOffice 26.x en este equipo con `winget install TheDocumentFoundation.LibreOffice` (`C:\Program Files\LibreOffice\program\soffice.exe`, ya lo detecta `rutaSoffice`). En producción lo trae el Dockerfile (requiere cambiar el Build Pack de RunVer a Dockerfile). Con LibreOffice: PDF idéntico al Word y pestaña **«Vista exacta (PDF)»** en la vista previa (`GET …/vista?pdf=1`, no se guarda).
- **El cuadro de pérdida es siempre tabla de Word** (marcada con `tblCaption = cuadro-de-perdida`, leyenda incluida): desaparece la imagen con navegador. Al editar el Excel, `sincronizarWordConExcel` relee la planilla, rehace esa tabla y actualiza los totales del texto (UF y pesos) con una sustitución por marcadores que no toca números más largos (146,73 no cambia al cambiar 46,73). Se rehacen el PDF y el ZIP.
- **Fotos**: guardar la edición de una foto (galería o doble clic en la imagen del preview) llama a `sincronizarFotos`: el informe rehace su sección de fotografías con la selección y los recortes actuales (conserva la fachada; el nombre de cada imagen es `foto:<id>`), se regenera el anexo y se rehacen PDF y ZIP. Tarda ~15–20 s (anexo con ~90 fotos + PDF); el editor muestra el progreso.
- **Word**: edición con formato (negrita, cursiva, subrayado por tramos), párrafos nuevos y párrafos quitados (`aplicarEdiciones`, índices originales); Enter no parte párrafos (se usa el botón de insertar). Un párrafo con imágenes no se edita.
- Verificado de punta a punta (e2e con LibreOffice): Excel→cuadro y totales del Word, foto→informe y anexo (imagen y leyenda), negrita e inserción, PDF exacto; y en el navegador: doble clic en una foto del preview abre su editor y al guardar la imagen del documento cambia sola.
- Aprendizaje: en este entorno, un literal de plantilla con `\s\S` escrito por heredoc pierde la barra (`[sS]`): usar `String.raw` o escribir el fichero con la herramienta de escritura.

## Producción con Dockerfile: `playwright-core/browsers.json` (06/10/2026)
- El Build Pack de RunVer se cambió de Nixpacks a **Dockerfile** y se redesplegó (`/api/salud` → `libreoffice: true`, `chromium: true`). Al probarlo con sesión, «Ver y editar» y «Vista exacta (PDF)» devolvían **500 sin cuerpo**.
- Causa (log de ejecución en Coolify): `Cannot find module '/app/node_modules/playwright-core/browsers.json'`. El build `standalone` copia `playwright-core` pero no ese archivo, que el paquete lee de forma dinámica al cargarse; cualquier ruta que importe `lib/docs/navegador.ts` fallaba al cargar. `/api/salud` no lo detecta porque no importa Playwright.
- Arreglo: `./node_modules/playwright-core/browsers.json` en `outputFileTracingIncludes` (`next.config.ts`). Verificado en local: tras `npm run build` aparece en `.next/standalone/node_modules/playwright-core/` y el e2e completo (standalone + LibreOffice) termina con PDF exacto 200 (`%PDF-`, 1449 KB). El e2e ahora imprime el motivo cuando el PDF no responde 200.
- Aprendizaje: una imagen Docker con `output: standalone` no prueba nada con solo `/api/salud`; hay que probar una ruta que cargue cada dependencia externa (`serverExternalPackages`) con sesión real, porque el trazado no incluye los archivos que un paquete lee dinámicamente.
