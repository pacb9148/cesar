@AGENTS.md

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
