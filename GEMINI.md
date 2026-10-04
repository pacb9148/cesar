<!-- GENERADO AUTOMÁTICAMENTE — NO EDITAR AQUÍ.
     La fuente es ~/.claude/reglas/REGLAS.md.
     Los cambios hechos en este archivo se pierden al sincronizar.
     Regenerar: node ~/.claude/reglas/sincronizar.mjs -->
# Procedimiento de trabajo — Equipo Sistema OPC

> **FUENTE ÚNICA.** Este archivo es el original. Todo lo que leen las demás
> herramientas (Cursor, Codex, opencode, Copilot, Gemini…) se genera desde aquí
> con `sincronizar-reglas`. No editar las copias: se sobrescriben.

Válido para **todos los proyectos** y **cualquier modelo o editor**.

---

## Idioma

**Todo en español**: respuestas, documentación, interfaz, comentarios y commits.
Excepción: nombres de APIs, librerías y comandos, que se usan en inglés por
convención universal (`streamText`, `edge runtime`, `git rebase`).

---

## Cómo se trabaja

1. **Solo se dice «resuelto» con evidencia real**: salida de un comando, test en
   verde, verificación en el navegador. Nunca por suposición. Si algo no se ha
   probado, se dice que no se ha probado.

2. **No se inventan arreglos a ciegas.** Ante una duda técnica se investiga la
   causa o se pregunta. Un arreglo que «debería funcionar» y no se ha ejecutado
   es una hipótesis, no una solución.

3. **Se pregunta cuando la decisión es del dueño**: alcance, negocio, datos
   reales, gasto. Lo demás se decide y se cuenta.

4. **No se inventan capacidades**, ni propias ni de terceros. Si algo no se
   puede hacer, se dice con claridad y se ofrece lo más cercano que sí se pueda.

5. **Informes cortos.** Un párrafo con lo que se ha hecho. Un segundo párrafo
   solo si hay algo que el dueño DEBA saber: lo que le toca a él, un riesgo, una
   decisión pendiente. No se narra el proceso ni se enumeran comprobaciones
   rutinarias salvo que hayan fallado. Verificar a fondo y contar poco no son
   cosas opuestas.

6. **No agregar lo que no se ha pedido.** En caso necesario, preguntar u ofrecer
   alternativas de la misma o mejor calidad, sin instalar ni implementar herramientas
   o funcionalidades que el usuario no haya solicitado explícitamente.

7. **Aislamiento estricto de bases de datos por proyecto.** Cada proyecto tiene su propio
   conjunto de bases de datos (1 o más). Ningún agente debe tocar, consultar ni modificar
   bases de datos pertenecientes a otros proyectos (como `sici-tenantius`), a menos que
   estén explícitamente relacionados y su interacción sea estrictamente en función de lo
   establecido en dicha relación o por instrucción explícita del usuario propietario.

---

## Modelo según el tipo de tarea

| Tipo de trabajo | Modelo |
|---|---|
| Planificar, diseñar, arquitectura, análisis de alternativas | **Opus** |
| Desarrollar, implementar, refactorizar, corregir, tests | **Sonnet** |
| Tareas elementales: renombrar, formatear, leer, commits simples | **Haiku** |

**Lo que el asistente NO puede hacer**: cambiarse a sí mismo el modelo del hilo
principal. Eso lo fija el usuario. Afirmar lo contrario sería inventar una
capacidad.

**Lo que sí hace**: avisar del cambio al pasar de una fase a otra
(«🔀 Cambia a Sonnet para esta fase: `/model sonnet`») y **asignar el modelo
correcto al delegar** en un subagente, donde el enrutado sí es automático.

**Subagentes solo en trabajos grandes.** Uno arranca en frío y vuelve a deducir
contexto que ya está en la conversación: en una tarea corta cuesta más de lo que
aporta. Se reservan para una feature completa, una auditoría transversal o
varias fases coordinadas.

---

## Cierre de trabajo

Al finalizar **cada trabajo o jornada** (y antes de dar el trabajo por terminado):
**`git commit` + `git push`** al repositorio del proyecto, con mensaje en español
y resumen real de lo hecho. El repositorio local/privado es la única vía de
versionado durante el desarrollo.

El **push a producción o deploy** (Vercel, Supabase, servidores…) **nunca** se
hace sin orden explícita del dueño: el desarrollo vive en local hasta que el
dueño decida la salida a producción.

### Orden «+dap»: documentar, actualizar repos y push

Cuando el dueño escribe **`+dap`** (sola o al final de un mensaje), al terminar
lo que se esté haciendo se ejecuta, en este orden y sin volver a preguntar:

1. **Documentar**: lo hecho, las decisiones y lo aprendido, en el documento del
   proyecto (`DEVmemory.md` o equivalente), y en estas reglas si el aprendizaje
   sirve a otros proyectos.
2. **Actualizar repos**: commit de todo lo pendiente del trabajo, con mensaje en
   español que resuma lo hecho de verdad. Nada de ficheros ajenos al trabajo
   sin revisarlos antes.
3. **Push** a la rama remota, y comprobar que local y remoto quedan iguales y el
   árbol limpio.

`+dap` **es la orden explícita de push**. Si ese push dispara un despliegue
automático (por ejemplo, Vercel publicando `main`), se dice en el informe final.
Sin `+dap` ni otra orden explícita, se sigue la regla general de este apartado.

---

## Documentación de tareas y herramientas

Al finalizar la instalación de herramientas, habilidades (*skills*), o cualquier tarea especial o específica:
- **No generar únicamente el walkthrough genérico**, sino guardar el documento completo de guía o resumen directamente en `C:\Users\pacb9\Documents\Github Docs\` con un **nombre específico y descriptivo** acorde a la tarea realizada.

---

## Contraste — comprobación obligatoria

**Es el fallo que más se repite.** Ningún componente se da por terminado sin
haberlo medido en modo claro Y en modo oscuro.

El patrón que falla siempre: texto de color claro sobre un panel tintado. En
oscuro se ve bien; en claro el panel se vuelve pastel y **el texto desaparece**.

Reglas aprendidas a base de equivocarse:

- **Medir el ratio WCAG real contra el fondo compuesto**, en la pantalla que
  falla y con los paneles ABIERTOS. Comparar listas de clases no sirve: da
  falsos aprobados.
- **Recargar tras cambiar de tema.** Conmutarlo en caliente mide colores a
  medio camino de la transición e inventa los resultados.
- **Los placeholders son invisibles** para un medidor que recorre nodos de
  texto: son pseudo-elementos. Hay que auditarlos aparte.
- **Una clase base cubierta no cubre su variante**: `hover:text-white/70` es
  distinta de `text-white/70`.
- **Si el fondo real no cambia con el tema** —un panel sobre un lienzo oscuro,
  un color que elige el usuario— ni el texto ni el fondo deben ir por clases:
  van EN LÍNEA, que es lo único que la capa de tema no puede pisar.
- **Un `<span>`/`<td>` sin clase de color hereda, no es transparente.** En una
  celda de tabla o lista es fácil poner el texto sin `text-*` "porque el padre
  ya tiene color" — pero el heredado suele resolver a negro/por-defecto, no al
  color del tema, y en un panel oscuro queda casi invisible. Cada nodo de texto
  de una tabla de datos lleva su propio `text-slate-*/dark:text-slate-*`
  explícito, nunca por herencia.

---

## Código

- **KISS, YAGNI, DRY.** Archivos de máximo 500 líneas, funciones de 50.
- `camelCase` para variables y funciones, `PascalCase` para componentes,
  `kebab-case` para archivos.
- **Nunca `any`** (usar `unknown`). Validar toda entrada de usuario.
- **Nunca exponer secretos** en el código.
- Los comentarios explican **por qué**, no qué. Un comentario que repite lo que
  dice la línea siguiente es ruido.
- **Si dos caminos calculan lo mismo, comparten la constante.** Cuando lo que
  enseña la interfaz y lo que valida el servidor salen de la misma función pero
  cada llamada pone su propio límite, acaban discrepando: la pantalla ofrece
  algo que el servidor rechaza. Un único valor por defecto, sin cifras sueltas
  en las llamadas.

---

## Bitácora

Cada petición queda registrada con su fecha y hora en `bitacora/` dentro del
proyecto. Se crea sola en el primer uso y rota al superar los 100 KB.

Sirve para responder «¿qué pedí exactamente?» meses después, y para reconstruir
el hilo si una sesión se corta.

---

## Errores y aprendizajes: se documentan una vez

Cada error corregido se documenta donde corresponda para que no vuelva:

| Dónde | Cuándo |
|---|---|
| Documento de la feature | Errores propios de esa feature |
| Reglas del proyecto | Errores que afectan a varias features |
| Este archivo | Errores que aplican a **todos** los proyectos |

Y al corregir un patrón, se buscan **todas** las apariciones. Arreglar una y
dejar su hermana garantiza que el fallo vuelva por otro sitio.

**No sólo los errores.** Todo aprendizaje, método, procedimiento o estructura
que reduzca fallos o ahorre trabajo **sube a este archivo** si sirve más allá
del proyecto donde apareció. Un hallazgo que se queda en la memoria de un
proyecto se pierde para los otros doce, y para los que aún no existen.

El criterio para decidir si sube: *¿me habría ahorrado esto tiempo o un susto
en otro proyecto cualquiera?* Si la respuesta es sí, va aquí, aunque se
descubriera resolviendo algo muy concreto.

Se escribe la **regla**, no la anécdota: qué hacer la próxima vez, en una o
dos frases. El relato de cómo se descubrió va en el `DEVmemory` del proyecto.

> Recordatorio: la fuente es `~/.claude/reglas/REGLAS.md`. Tras editarla hay
> que ejecutar `node ~/.claude/reglas/sincronizar.mjs` o los cambios no llegan
> a ninguna herramienta. Se ejecuta **desde la carpeta de un proyecto** (o con
> `--global`): lanzado desde `~/.claude/reglas` trata esa carpeta como proyecto
> y la llena de copias que sobran.

**Un comando para el dueño va en SU shell.** Antes de darle una orden para que
la ejecute, mirar qué terminal usa (en Windows suele ser PowerShell): la
sintaxis de bash —llaves `{a,b}`, `rm -f`, `&&` en versiones viejas— allí es
un error de análisis. Y si el agente puede ejecutarlo él mismo con permiso, lo
hace en vez de pasarle el trabajo.

---

## Secretos y credenciales

Aprendido a base de un incidente real con seis credenciales vivas versionadas.

**Buscar todos los formatos, no uno.** Un barrido que sólo busca JWT `eyJ…` da
falsa tranquilidad. Hay que cubrir a la vez: `eyJ…`, `sb_secret_`, `sk-`,
`sk-or-`, `vcp_`, `ghp_`, `github_pat_`, `polar_oat_`, `AIza`, `xox[baprs]-`,
`tvly-`, `re_`, y `-----BEGIN … PRIVATE KEY-----`. Un recuento hecho con un
solo patrón pasó de 4 a 6 credenciales al ampliarlo.

**Mirar donde el grep no llega.** Aparecieron claves en sitios que ningún
barrido del código encuentra: una fila de la base de datos que se renderiza en
la web, un componente de React que las mostraba como "ejemplo", ficheros de
configuración del editor (`.mcp.json`, `.claude/settings.json`) y el historial
de la terminal.

**Rotar primero, purgar después.** Reescribir el historial de git NO invalida
una clave: sigue siendo válida hasta que se rote en su panel. La purga elimina
la exposición futura, no el riesgo presente.

**Jubilar es mejor que rotar.** Si el proveedor ofrece un esquema de claves más
nuevo, migrar a él y desactivar el viejo deja las filtradas muertas para
siempre, en vez de sustituidas por otras del mismo tipo.

**Nunca copiar y pegar una clave a mano.** Ese paso es por donde se filtran:
del portapapeles acaba en un script, en un JSON de configuración o en el
historial. Si el proveedor tiene CLI o API, se automatiza el traslado.

**Nunca teclear un secreto en una terminal.** Queda en el historial del shell
en texto plano. En PowerShell se usa `Read-Host -AsSecureString`.

**Comprobar la revocación con evidencia.** Una clave rotada tiene que devolver
401. Si la vieja sigue respondiendo, el panel generó una nueva pero no revocó
la anterior, y el incidente sigue abierto sin que nadie lo note.

**Orden al sustituir una credencial en producción**, sin saltarse pasos: crear
la nueva → actualizar todos los consumidores (local, CI, variables del
proveedor de despliegue) → redesplegar → verificar → sólo entonces revocar la
vieja. Invertirlo tira el servicio.

---

## Verificación: lo que no se comprueba, no está hecho

**Un paso de CI que no está configurado no falla, decora.** En un proyecto el
paso de lint llevaba meses sin linter instalado: no daba error, simplemente no
hacía nada. Comprobar que cada paso de CI produce salida real, no que exista.

**Las variables `NEXT_PUBLIC_*` se incrustan en el build.** Cambiarlas sin
redesplegar no cambia nada. Se verifica descargando el bundle de producción y
buscando el valor.

**Nunca arrancar el servidor y compilar después.** `next start` seguido de un
`npm run build` deja el servidor sirviendo un manifiesto que apunta a ficheros
ya borrados: *Loading chunk N failed*. Siempre `build` y luego `start`.

**En Next.js App Router, rutas protegidas exigen `force-dynamic`.** Si un layout
o página privada no exporta `export const dynamic = 'force-dynamic'`, el build
puede prerenderizarla como HTML estático (`○`), y los servidores o proxies sirven
la pantalla sin evaluar cookies ni ejecutar la redirección. Siempre forzar dinámico
(`ƒ`) y `revalidate = 0` en layouts y páginas privadas.

**En dashboards con sidebar, nunca usar `min-h-screen` en el aside si el layout usa `h-screen overflow-hidden`.** Si los submenús superan 100vh, el navegador activa el scroll de la ventana (`window.scrollY`), desplazando todo el contenedor de 100vh hacia arriba y dejando la pantalla en un vacío negro. El layout raíz debe anclarse con `fixed inset-0 overflow-hidden` y el sidebar debe llevar `h-full max-h-screen overflow-y-auto` con scroll interno.

**En bibliotecas de medios, nunca renderizar con `<img>` sin discriminar videos.** Un archivo `.mp4` en una etiqueta `<img>` siempre falla como imagen rota; debe bifurcar dinámicamente a `<video>` con vista previa y reproductor nativo.

**Una captura de pantalla encuentra lo que leer código no encuentra.** Los
fallos de contraste aparecieron mirando imágenes, no revisando clases.

**Un script que guarda capturas debe validar que capturó la aplicación.** Si no
lo hace, guarda páginas de error del navegador con el nombre de la pantalla que
tocaba y nadie se entera. Igual para cualquier automatización que escriba
ficheros: verificar antes de escribir, y no pisar lo bueno con lo malo.

**Un codemod se valida con typecheck y build, siempre.** Un reemplazo por
expresión regular sobre importaciones rompió `import Link from 'next/link'`
dejándolo en `importfrom`. Lo cazó el typecheck; a ojo no se veía.

**Deuda existente: se congela con un tope, no se ignora.** Fijar el número
actual de avisos como máximo permitido impide que crezca mientras se limpia.

---

**Los campos de una API externa se leen del esquema oficial, no de un resumen.**
Un resumen automático dio `name` para las variables de Coolify; su `openapi.json`
dice `key`. Descargar el esquema y listar campos con un script antes de escribir
el cliente, y probar contra un servidor simulado con esas mismas rutas.

**Una clase `dark:` con un color que no está en la paleta de ESA página no genera
nada.** `dark:text-brand-violetAccent` no existía en la config de Tailwind de una
página y el texto se quedaba en el color claro (3.3:1 en oscuro). Solo lo cazó
medir el ratio WCAG; y al corregirlo aparecieron tres textos más con el mismo fallo.

**Un `<select>` con opciones largas desborda un modal en móvil.** Ponerle `max-w`.

---

**Un script generado se prueba EJECUTÁNDOLO**, no leyéndolo: en una carpeta temporal, con el intérprete real (pwsh, bash), comprobando que actualiza sin duplicar, crea lo que falta y no deja BOM ni comillas rotas.

**Tailwind por CDN genera las clases unos milisegundos después de insertar el nodo.** Medir contraste justo tras crear un elemento da un falso fallo: esperar unos cientos de ms antes de medir. Y los símbolos (✓, !) también cuentan: blanco sobre `emerald-600` da 3.77:1, usar el tono 700.

**Un servidor no puede escribir en el equipo del usuario.** Para actualizar un archivo local (p. ej. `.env.local`) desde una web: File System Access API (Chrome/Edge) con vista previa de los cambios y confirmación explícita, releyendo el archivo justo antes de escribir; en otros navegadores, descarga o script.

---

**DNS: un ALIAS/ANAME en `@` impide crear un registro A** (error tipo «RRset … IN ALIAS must not be used with A»). Hay que borrar el ALIAS, no un A. Se reconoce porque el dominio resuelve a IPs del proveedor que cambian en cada consulta.

**Un dominio «no cambia» casi siempre por caché local, no por DNS.** Comprobar contra un resolutor público (`8.8.8.8`) y probar el servidor con `curl --resolve dominio:443:IP` antes de que propague; comparar el `<title>` para distinguir sitio viejo de nuevo. Y `www` es otro registro: puede seguir apuntando al hosting anterior.

**Certificado `TRAEFIK DEFAULT CERT` = Let's Encrypt aún no emitió** (`openssl s_client -servername dominio`): con «forzar HTTPS» el navegador avisará hasta que se emita.

---

**Añadir una dependencia sin subir el lockfile rompe el despliegue.** Con `pnpm install --frozen-lockfile`, `npm ci` o `yarn --frozen-lockfile` el build aborta si `package.json` y el lockfile no coinciden (`ERR_PNPM_OUTDATED_LOCKFILE`). Commit del lockfile junto a `package.json`; si un despliegue empieza a fallar de golpe, comparar `git log` de ambos ficheros antes de mirar nada más.

**Un explorador de base de datos que solo mira el schema aprovisionado parece vacío** si el proyecto crea sus tablas con `CREATE TABLE public.x` desde su propio código. Listar también `public` (filtrando por privilegios del rol) y abrir el schema que tenga las tablas.

**Los modales grandes de gestión se convierten en páginas con ruta en el hash** (`#/proyecto/<id>/<pestaña>`): se puede enlazar, recargar y volver atrás sin duplicar menú, sesión ni tema. En móvil el menú lateral pasa a solo iconos.

**Para probar una interfaz que toca producción, arnés temporal con la base y el proveedor simulados** (pg y API en memoria), arrancado desde `.claude/launch.json` y retirado al acabar; el SQL real queda sin verificar y se dice.

---

**Un campo que una API acepta al escribir puede no devolverse al leer.** Comprobar en el esquema de RESPUESTA del `openapi.json` (no solo en el de la petición) que el campo existe; si falta, guardar el valor propio en nuestra base. Un interruptor que "se vuelve a poner solo" tras recargar suele ser esto.

---

**Un cliente de base de datos que traga los errores de creación de tablas oculta que no existen.** Si un rol multi-tenant no puede crear en `public` (`REVOKE` + PG15), un `CREATE TABLE public.x` falla en silencio y la app cae a ficheros: no usar el prefijo `public.` en el SQL de proyectos que van a bases con schema por cliente, y registrar/propagar el error de `ensureSchema` en vez de devolver `null`.

**Todo estado que se muestra como «en curso» necesita sondeo hasta que termine**, también el log y la cabecera; si no, parece atascado.

---

**Coolify: `real_value` de una variable literal viene envuelto en comillas simples; `value` no.** Mostrar y reeditar `value`; si no, «Editar → Guardar» acumula comillas y una `DATABASE_URL` deja de ser una URL. Mirar siempre los DOS campos de la respuesta y quitar comillas envolventes al guardar.

---

**En `pg`, la URL manda sobre la opción `ssl` del código.** `new Pool({ connectionString, ssl: {…} })` fusiona con `Object.assign(config, parse(url))`, así que `?sslmode=disable` en la URL desactiva un SSL forzado por la app (lo mismo en Prisma, postgres.js y libpq). Para una red privada sin SSL, ponerlo en la URL que se entrega al cliente en vez de pedirle que cambie su código.

**Un botón de diagnóstico (probar la conexión y explicar el motivo) vale más que pedir logs al cliente.** Debe conectar solo a la infraestructura propia y con credenciales del propio tenant (si no, es un SSRF/fuerza bruta), y no devolver secretos.

---

**Una inicialización que se marca como hecha DESPUÉS de ejecutarse entra en bucle si lo que ejecuta la vuelve a llamar.** `queryPg` → `ensureSchema` → migración → `queryPg` con `initialized=true` al final lanzó cientos de migraciones a la vez (build fallido y web caída). Marcar el flag ANTES, un solo vuelo por proceso, y la migración en segundo plano sin bloquear las consultas.

**Durante `next build` la app no debe tocar la base de datos de producción**: el build renderiza páginas en paralelo y ejecuta lo que haya a nivel de módulo. La URL de la base va como variable solo de ejecución (Coolify: Build time → Not available during build) y el código comprueba `NEXT_PHASE === 'phase-production-build'`.

**Si un despliegue deja la web sin responder, primero restaurar el servicio y luego investigar**; los logs de ejecución (no los de build) dicen por qué.

---

**Dar acceso a un agente o CLI: autorización por código (device flow), nunca contraseñas ni tokens pegados.** El CLI genera el secreto y manda solo su SHA-256; el dueño aprueba un código corto viendo nombre, agente e IP; el secreto local pasa a ser el token (la plataforma no lo ve nunca). Tokens con permisos (lectura/escritura), caducidad, revocación inmediata, y un token jamás puede crear otros. «Solo lectura» con SQL se garantiza con `BEGIN READ ONLY`, no analizando el texto.

**Un CLI pensado para agentes: salida JSON cuando no hay terminal, progreso por stderr, códigos de salida distintos, `ayuda --json`, operaciones destructivas que se niegan sin `--confirmar`, y los secretos se mueven de A a B dentro del CLI sin mostrarlos** (si no, acaban en la conversación del modelo). Un archivo con secretos que escribe el CLI se añade a `.gitignore`.

**Instalar con una línea: `curl URL | node --input-type=module - init` va bien; en Windows PowerShell 5.1 la tubería estropea los acentos, así que se descarga a archivo (`iwr -useb URL -OutFile`) y se ejecuta.** El CLI se copia dentro del proyecto (`.runwebx/`) para no depender del PATH.

**Un autoactualizador debe DESCARGAR, no leerse a sí mismo, y comprobar que lo descargado arranca (`--version`) antes de sustituir** al actual.

**Cuando un cliente (CLI/SDK) llama a un servidor propio, una prueba comprueba que cada ruta que usa EXISTE en los routers reales** (recorrer `router.stack`); y lo generado (bundle, referencia) se versiona con un `--check` en los tests para que no se desincronice.

**Un middleware que salta la sesión por una cabecera debe limitarse a las rutas que lo necesitan**: en el resto, las rutas esperan `req.session` y reventarían.

---

## Datos personales en capturas y documentación

Aprendido publicando el manual de un SaaS con usuarios reales.

**Una captura de pantalla es una publicación de datos.** Antes de guardar la
imagen de un listado de personas, mirar qué hay dentro: nombres, fotos,
correos, ocupaciones, ciudades. Que la pantalla sea interna no significa que la
imagen lo sea.

**Los ficheros estáticos no suelen pasar por el middleware.** En Next, en
Django, en casi todo, `/public` se sirve por extensión sin comprobar la sesión.
Una captura guardada ahí se descarga sin iniciar sesión con sólo acertar la
URL, aunque la página que la muestra exija estar dentro. Antes de dar por
privada una imagen, comprobar la exención en el código de rutas públicas.

**Tapar al mostrar no es tapar.** Una banda dibujada al renderizar —CSS, SVG,
un recuadro encima— deja el fichero original intacto. La única ocultación real
es la que se quema en el píxel **al capturar**.

**Un desenfoque es reversible; una barra sólida no.** Un gaussiano sobre texto
corto se revierte. Para datos personales, barra sólida siempre.

---

## La documentación se audita con capturas, no leyéndola

Un manual escrito mirando el código describe lo que el código *parece* hacer.
Poner la captura real al lado del texto es lo que destapa la diferencia.

En una sola pasada aparecieron: un icono documentado que no existe en la
interfaz, un recuento de controles equivocado, un selector de treinta opciones
descrito como un interruptor de dos, y una afirmación sobre dónde se guarda una
preferencia que era exactamente la contraria de la verdad. Ninguna se veía
leyendo el documento.

**Regla:** toda figura de una guía se contrasta contra la pantalla real antes
de publicarla, y el texto que la rodea se lee **mirando la imagen**, no de
memoria.

**Corolario:** si una figura ilustra una tabla o un estado que la cuenta de
prueba no tiene, la captura sale vacía y las anotaciones señalan al aire. Hay
que provocar el estado —o cambiar la figura—, nunca dejarla como está.

---

## Automatizar capturas: encuadrar por elemento, no por píxeles

**Un recorte en coordenadas fijas es una estimación que caduca.** Cortaba
botones por la mitad y dejaba medio panel vacío. Recortar al **elemento**
(`locator.screenshot()`, o la unión de varias cajas cuando un control sobresale
de su panel) se ajusta solo cuando cambia el diseño, y falla ruidosamente
cuando el selector desaparece.

**Validar que se capturó la pantalla pedida, no sólo que hubo sesión.**
Comprobar únicamente que no rebotó al login deja pasar la otra redirección: la
de permisos. Con el rol equivocado se guarda la página de acceso denegado con
el nombre de la pantalla que tocaba. Comparar la ruta final con la esperada.

**Guardar la sesión del navegador entre ejecuciones.** Recapturar es un ciclo
de tomar, mirar, corregir y volver a tomar; pedir la contraseña en cada vuelta
acaba con alguien tecleándola donde no debe. El fichero de sesión va al
`.gitignore`, con una opción para borrarlo.

**Anotar por datos, no quemando flechas en la imagen**, para poder recapturar
sin rehacer las anotaciones. Pero entonces hay que comprobar que el
renderizador pinta *todos* los campos que el modelo acepta: un `texto` que el
componente ignora se pierde en silencio y nadie se entera hasta mirar la
figura.

---

## Escapes: el heredoc se come las barras invertidas

Al pasar un script por un heredoc de shell, las barras invertidas dobles se
colapsan: un `\\n` escrito en el script llega como `\n`, se convierte en un salto
de línea real dentro de un literal de cadena y rompe el fichero generado. Lo
mismo con `\\s` en una expresión regular, que queda en una `s` literal y no casa
nada — sin error, sólo un resultado vacío.

**También ocurre con `python3 - <<EOF`** (rompió regex y `
` tres veces): el código con barras invertidas se escribe con la herramienta de escritura, no con un heredoc.

**Regla:** al generar código con un script, construir la barra invertida aparte
(`chr(92)`, `String.raw`) en vez de escribirla escapada, y **verificar el
fichero generado** con un comprobador de sintaxis antes de darlo por bueno. Un
reemplazo que «no encuentra nada» suele ser esto, no un anclaje mal puesto.

---

## Cuando una orden no se puede cumplir

Si algo queda fuera de lo que el agente puede hacer —escribir contraseñas en
un formulario, por ejemplo— se dice en una frase, sin rodeos y sin sermón, y
**se busca la vía alternativa antes de contestar**. Decir «no puedo» sin haber
comprobado si existe un camino por CLI o por API es pereza disfrazada de
límite.

Y cuando de verdad no hay vía, se deja al dueño el trabajo mínimo: el clic
exacto, en la pantalla exacta, con todo lo demás ya preparado y verificado.

---

## Seguridad y vulnerabilidades: batería de pruebas obligatoria (Strix & AppSec)

Todo proyecto existente y **cualquier proyecto que se inicie en el futuro** debe
contar con la batería de pruebas de seguridad y detección temprana de
vulnerabilidades para atajar fallos desde el principio.

**Al iniciar o recibir un proyecto:**
1. **Verificar que el proyecto dispone de su script de batería de seguridad**
   `scripts/bateria-seguridad.ps1` y su workflow `.github/workflows/strix-security-scan.yml`.
   Si no los tiene, se instalan de inmediato desde la plantilla global en
   `~/.agents/templates/security-battery/`.
2. **Ejecutar la batería de seguridad antes de dar por cerrada cualquier sesión:**
   `npm run test:security` o `pwsh ./scripts/bateria-seguridad.ps1`.
3. **Comprobaciones que componen la batería:**
   - **Secretos:** barrido regex exhaustivo de credenciales en código, git y `.env`.
   - **Dependencias:** `npm audit --audit-level=high` o equivalente (`pip/uv audit`),
     sin tolerar vulnerabilidades críticas ni altas desatendidas.
   - **Superficie expuesta:** verificación de variables `NEXT_PUBLIC_*` para impedir
     fugas de claves de servicio (`SERVICE_ROLE`, `SECRET_KEY`, `DATABASE_URL`) hacia el cliente.
   - **Strix AppSec & OWASP Top 10:** invocar las habilidades de Strix
     (`/find-security-vulnerabilities-in-code`, `/owasp-top-10-testing`) ante cambios
     en autenticación, APIs o lógica de acceso.
4. **Remediación inmediata:** Ante cualquier vulnerabilidad detectada, se aplica la
   habilidad `/fix-security-vulnerabilities-with-strix` para parchear la causa raíz y
   se vuelve a ejecutar la batería para verificar el cierre efectivo con evidencia real.

---

## Continuidad de contexto y memoria persistente (Claude-Mem)

`claude-mem` está activo globalmente en el sistema para mantener la continuidad entre sesiones, agentes y entornos de desarrollo (Claude Code, Antigravity, Cursor, OpenCode, Windsurf, etc.).

- **Memoria persistente unificada:** Todos los IDEs y agentes comparten el almacén centralizado de memoria en `~/.claude-mem/` (`claude-mem.db`).
- **Contexto automático por proyecto:** Al iniciar una sesión o continuar el desarrollo en cualquier proyecto, el contexto previo (arquitectura, decisiones de diseño, convenciones, estado de tareas) se consulta e inyecta automáticamente mediante hooks o archivos de reglas (`GEMINI.md`, `.cursor/rules/claude-mem-context.mdc`, `AGENTS.md`, `.windsurf/rules/claude-mem-context.md`).
- **Preservación entre herramientas:** Si se cambia de IDE (por ejemplo de Claude Code a Antigravity o Cursor) o de modelo, la memoria del proyecto se mantiene intacta sin perder el hilo ni las fuentes de datos.
- **Worker local:** El servicio daemon se ejecuta localmente en `http://127.0.0.1:37777` (`claude-mem start`) sin enviar datos a la nube externa salvo configuración explícita.


**Coolify (y la mayoría de despliegues por Git) clona la rama `main`.** Un repositorio creado con `git init` en Git para Windows nace en `master` y el despliegue falla con `Remote branch main not found in upstream origin`. Crear con `git init -b main`, y antes de redesplegar comprobar que la rama existe en el remoto (`git ls-remote --heads origin`). Un repositorio vacío en GitHub no tiene ninguna rama.

---

## Notas propias de Gemini CLI

**Configuración:** `~/.gemini/settings.json` (global) o `.gemini/settings.json` (proyecto).

**Bitácora:** el evento es **`BeforeAgent`**. ⚠️ En Gemini CLI **no existe**
`UserPromptSubmit` —el nombre que usan Claude Code y Codex—: ponerlo aquí no da error, pero no
se dispara nunca, que es peor porque parece funcionar. El `timeout` va en **milisegundos**.

Manual completo: `~/.claude/reglas/Manual de implementacion de bitacora.md`

<!-- runwebx:inicio -->
## RunWebX CLI — gestión de la infraestructura de este proyecto

Este proyecto se despliega en RunWebX. Para proyectos, dominio, variables de entorno, logs,
despliegues, GitHub y bases de datos usa el CLI local. NO pidas contraseñas ni claves al usuario.

    node .runwebx/runwebx.mjs <comando> [opciones]

- Descubre los comandos: `node .runwebx/runwebx.mjs ayuda` (o `ayuda --json`). Sin terminal, la salida es JSON.
- Sin sesión: `node .runwebx/runwebx.mjs login` muestra un enlace y un código. Díselo al usuario para que lo apruebe en su
  dashboard y deja el comando esperando. Si tu herramienta limita el tiempo de los comandos, usa
  `login --sin-esperar` y después `login --continuar`.
- Comprueba la cuenta, el plan y los permisos del acceso: `node .runwebx/runwebx.mjs whoami`.

Reglas:
1. Las operaciones destructivas (eliminar, vaciar, borrar filas o columnas, quitar dominio, cambiar la contraseña
   de una base) se niegan sin `--confirmar`. Usa `--confirmar` SOLO si el usuario lo ha autorizado explícitamente
   en esta conversación para esa operación concreta.
2. Nunca escribas secretos (contraseñas, cadenas de conexión, tokens) en la conversación, en el código ni en commits.
   Para conectar una base a un proyecto usa `db conectar`; para tener las variables en local, `env bajar`.
   Ambos mueven el valor sin mostrarlo.
3. Antes de cambiar la estructura de una base, inspecciónala (`db tablas`, `db filas`). Los cambios sobre datos de
   producción los confirma el usuario.
4. Los cambios de variables solo se aplican al redesplegar: `proyectos redesplegar`.
5. Si un despliegue falla: `despliegues listar` y luego `despliegues log <uuid>` (incluye un diagnóstico de la causa).
6. Si la aplicación no conecta con su base: `conexion probar` explica el motivo.
<!-- runwebx:fin -->
