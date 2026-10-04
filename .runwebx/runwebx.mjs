#!/usr/bin/env node
// RunWebX CLI v1.0.0 — generado por scripts/build-cli.mjs desde cli/src/. NO editar a mano.
// Sin dependencias · Node 18 o superior · https://runwebx.com/cli

// ===== 00-imports.mjs =====
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync, statSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import process from 'node:process';

// ===== 10-nucleo.mjs =====
// ---------------------------------------------------------------------------
// Núcleo: constantes, errores, lectura de argumentos y formato de salida.
// Convención de todo el CLI: los DATOS salen por stdout (JSON si no hay terminal) y el
// progreso/avisos por stderr, para que un agente pueda leer el resultado sin ruido.
// ---------------------------------------------------------------------------

const VERSION = '1.0.0';
const API_POR_DEFECTO = 'https://runwebx.com';
const DIR_PROYECTO = '.runwebx';
const TIMEOUT_MS = 60_000;

// Opciones válidas en cualquier comando.
const FLAGS_GLOBALES = {
  json: { tipo: 'bool', desc: 'Salida en JSON (por defecto si no hay terminal)' },
  texto: { tipo: 'bool', desc: 'Salida legible aunque no haya terminal' },
  api: { tipo: 'str', desc: 'URL de la plataforma (por defecto https://runwebx.com)' },
  proyecto: { tipo: 'str', alias: 'p', desc: 'Proyecto RunVer (nombre o id)' },
  base: { tipo: 'str', alias: 'b', desc: 'Base de datos RunSup (nombre o id)' },
  confirmar: { tipo: 'bool', desc: 'Confirma una operación destructiva' },
  ayuda: { tipo: 'bool', alias: 'h', desc: 'Muestra la ayuda del comando' },
};

class ErrorCli extends Error {
  constructor(mensaje, { codigo = 1, http = null, sugerencia = null } = {}) {
    super(mensaje);
    this.name = 'ErrorCli';
    this.codigo = codigo;
    this.http = http;
    this.sugerencia = sugerencia;
  }
}

const aviso = (mensaje) => process.stderr.write(`${mensaje}\n`);
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------- Argumentos --

function buscarOpcion(spec, texto) {
  const porNombre = Object.entries(spec).find(([n]) => n === texto);
  if (porNombre) return [porNombre[0], porNombre[1]];
  const porAlias = Object.entries(spec).find(([, s]) => s.alias === texto);
  return porAlias ? [porAlias[0], porAlias[1]] : null;
}

function guardarOpcion(flags, nombre, spec, valor) {
  if (spec.tipo === 'bool') { flags[nombre] = valor === undefined ? true : valor !== 'false'; return; }
  if (valor === undefined) throw new ErrorCli(`La opción --${nombre} necesita un valor`, { codigo: 2 });
  if (spec.tipo === 'num') {
    const n = Number(valor);
    if (!Number.isFinite(n)) throw new ErrorCli(`La opción --${nombre} debe ser un número, no «${valor}»`, { codigo: 2 });
    flags[nombre] = n;
  } else if (spec.tipo === 'multi') {
    (flags[nombre] ||= []).push(valor);
  } else {
    flags[nombre] = valor;
  }
}

/** Separa posicionales y opciones. Solo acepta las opciones declaradas (las globales + las
 * del comando): una opción inventada por un agente falla con la lista de las válidas. */
function parsearArgumentos(tokens, spec) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--') { pos.push(...tokens.slice(i + 1)); break; }
    const larga = t.startsWith('--');
    if (!larga && !/^-[a-zA-Z]$/.test(t)) { pos.push(t); continue; }
    const igual = larga ? t.indexOf('=') : -1;
    const crudo = larga ? (igual > 0 ? t.slice(2, igual) : t.slice(2)) : t.slice(1);
    const encontrada = buscarOpcion(spec, crudo);
    if (!encontrada) {
      const validas = Object.keys(spec).map((n) => `--${n}`).join(' ');
      throw new ErrorCli(`Opción desconocida: ${larga ? '--' : '-'}${crudo}. Opciones válidas: ${validas}`, { codigo: 2 });
    }
    const [nombre, s] = encontrada;
    let valor = igual > 0 ? t.slice(igual + 1) : undefined;
    if (valor === undefined && s.tipo !== 'bool') valor = tokens[++i];
    guardarOpcion(flags, nombre, s, valor);
  }
  return { pos, flags };
}

// ----------------------------------------------------------------- Salida --

function celda(v) {
  if (v === null || v === undefined) return '';
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
}

function tablaTexto(filas) {
  const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))].filter((c) => filas.some((f) => !esObjeto(f[c]) && !Array.isArray(f[c]))).slice(0, 9);
  const anchos = cols.map((c) => Math.max(c.length, ...filas.map((f) => celda(f[c]).length)));
  const linea = (valores) => valores.map((v, i) => String(v).padEnd(anchos[i])).join('  ').trimEnd();
  return [linea(cols), linea(anchos.map((a) => '-'.repeat(a))), ...filas.map((f) => linea(cols.map((c) => celda(f[c]))))].join('\n');
}

function objetoTexto(obj, sangria = '') {
  return Object.entries(obj).map(([k, v]) => {
    if (Array.isArray(v) && v.length && v.every(esObjeto)) return `${sangria}${k}:\n${tablaTexto(v).split('\n').map((l) => `${sangria}  ${l}`).join('\n')}`;
    if (esObjeto(v)) return `${sangria}${k}:\n${objetoTexto(v, `${sangria}  `)}`;
    return `${sangria}${k}: ${Array.isArray(v) ? JSON.stringify(v) : celda(v)}`;
  }).join('\n');
}

function aTexto(datos) {
  if (datos === null || datos === undefined) return 'OK';
  if (typeof datos === 'string') return datos;
  if (Array.isArray(datos)) {
    if (!datos.length) return '(vacío)';
    return datos.every(esObjeto) ? tablaTexto(datos) : datos.map(celda).join('\n');
  }
  return esObjeto(datos) ? objetoTexto(datos) : String(datos);
}

/** {columnas, filas} de la API -> lista de objetos legible. */
function filasComoObjetos(r) {
  return r.filas.map((fila) => Object.fromEntries(r.columnas.map((c, i) => [c, fila[i]])));
}

function formatoTexto(datos, def) {
  if (def?.imprimir && esObjeto(datos) && typeof datos[def.imprimir] === 'string') {
    const extra = datos.diagnostico ? `\n\nDiagnóstico: ${datos.diagnostico.titulo}\n${datos.diagnostico.solucion}` : '';
    return `${datos[def.imprimir]}${extra}`;
  }
  if (def?.formato === 'filas' && esObjeto(datos) && Array.isArray(datos.columnas)) {
    const pie = [datos.total != null ? `${datos.total} filas en total` : null, datos.comando ? `${datos.comando}${datos.filasAfectadas != null ? ` · ${datos.filasAfectadas} filas afectadas` : ''}` : null].filter(Boolean).join(' · ');
    return `${datos.columnas.length ? tablaTexto(filasComoObjetos(datos)) : '(sin columnas)'}${pie ? `\n${pie}` : ''}`;
  }
  return aTexto(datos);
}

function modoJson(flags) {
  if (flags.json) return true;
  if (flags.texto) return false;
  return process.stdout.isTTY !== true;
}

function imprimir(datos, flags, def) {
  const salida = modoJson(flags) ? JSON.stringify(datos ?? { ok: true }, null, 2) : formatoTexto(datos, def);
  process.stdout.write(`${salida}\n`);
}

function imprimirError(err, flags) {
  const e = err instanceof ErrorCli ? err : new ErrorCli(err?.message || String(err), { codigo: 1 });
  if (modoJson(flags || {})) {
    process.stderr.write(`${JSON.stringify({ error: e.message, http: e.http, sugerencia: e.sugerencia }, null, 2)}\n`);
  } else {
    process.stderr.write(`Error: ${e.message}\n${e.sugerencia ? `${e.sugerencia}\n` : ''}`);
  }
  return e.codigo;
}

/** Valor que no debe viajar a la conversación del agente: se enseña tapado. */
const ocultar = (valor) => `********(${String(valor ?? '').length} car.)`;

// ===== 20-api.mjs =====
// ---------------------------------------------------------------------------
// Credenciales, configuración del proyecto y cliente HTTP.
//  - Credenciales: ~/.runwebx/credentials.json (por usuario del sistema, modo 0600,
//    FUERA del proyecto: nunca acaban en git). Se guarda el token por cada API.
//  - Configuración: .runwebx/config.json del proyecto (sin secretos, se puede commitear).
// ---------------------------------------------------------------------------

const dirUsuario = () => process.env.RUNWEBX_HOME || join(homedir(), '.runwebx');
const archivoCredenciales = () => join(dirUsuario(), 'credentials.json');
const archivoPendiente = () => join(dirUsuario(), 'login-pendiente.json');

function leerJson(ruta) {
  try { return JSON.parse(readFileSync(ruta, 'utf8')); } catch { return null; }
}

/** Escritura atómica y privada (0600): un archivo a medias o legible por otros
 * usuarios del equipo sería peor que no guardar nada. */
function escribirJsonPrivado(ruta, datos) {
  mkdirSync(dirname(ruta), { recursive: true, mode: 0o700 });
  const temporal = `${ruta}.${process.pid}.tmp`;
  writeFileSync(temporal, `${JSON.stringify(datos, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporal, ruta);
  try { chmodSync(ruta, 0o600); } catch { /* en Windows no aplica */ }
}

function leerCredenciales(api) {
  return leerJson(archivoCredenciales())?.[api] || null;
}

function guardarCredenciales(api, datos) {
  const todas = leerJson(archivoCredenciales()) || {};
  todas[api] = datos;
  escribirJsonPrivado(archivoCredenciales(), todas);
}

function borrarCredenciales(api) {
  const todas = leerJson(archivoCredenciales()) || {};
  const existia = api in todas;
  delete todas[api];
  escribirJsonPrivado(archivoCredenciales(), todas);
  return existia;
}

// ------------------------------------------------- Configuración del proyecto --

/** Busca .runwebx/config.json subiendo desde la carpeta actual (se puede trabajar desde subcarpetas). */
function buscarConfigProyecto(desde = process.cwd()) {
  let dir = resolve(desde);
  for (;;) {
    const ruta = join(dir, DIR_PROYECTO, 'config.json');
    if (existsSync(ruta)) return { ruta, raiz: dir, datos: leerJson(ruta) || {} };
    const padre = dirname(dir);
    if (padre === dir) return null;
    dir = padre;
  }
}

function guardarConfigProyecto(cambios, raiz = process.cwd()) {
  const ruta = join(raiz, DIR_PROYECTO, 'config.json');
  const actual = leerJson(ruta) || {};
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, `${JSON.stringify({ ...actual, ...cambios }, null, 2)}\n`);
  return ruta;
}

function resolverApi(flags, config) {
  return String(flags.api || process.env.RUNWEBX_API || config?.datos?.api || API_POR_DEFECTO).replace(/\/+$/, '');
}

function crearContexto(flags) {
  const config = buscarConfigProyecto();
  const api = resolverApi(flags, config);
  const token = process.env.RUNWEBX_TOKEN || leerCredenciales(api)?.token || null;
  return { flags, config, api, token };
}

// -------------------------------------------------------------- Cliente HTTP --

async function enviar(url, { metodo = 'GET', cuerpo, token } = {}) {
  const cabeceras = { Accept: 'application/json', 'User-Agent': `runwebx-cli/${VERSION}` };
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  if (token) cabeceras.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const origen = new URL(url).origin;
    throw new ErrorCli(`No se pudo conectar con ${origen} (${err.cause?.code || err.name})`, { codigo: 1, sugerencia: 'Comprueba la conexión a internet y la URL (--api o RUNWEBX_API).' });
  }
  const texto = await res.text();
  let datos = null;
  if (texto) { try { datos = JSON.parse(texto); } catch { datos = { respuesta: texto.slice(0, 500) }; } }
  if (!res.ok) {
    const sugerencia = res.status === 401 ? 'Ejecuta «node .runwebx/runwebx.mjs login» para iniciar sesión.' : null;
    throw new ErrorCli(datos?.error || `La plataforma respondió HTTP ${res.status}`, { codigo: res.status === 401 ? 2 : 1, http: res.status, sugerencia });
  }
  return datos;
}

/** Llamada autenticada a /api/tenant. `consulta` descarta valores vacíos. */
async function llamar(ctx, metodo, ruta, { consulta, cuerpo } = {}) {
  if (!ctx.token) {
    throw new ErrorCli('No has iniciado sesión en RunWebX', { codigo: 2, sugerencia: 'Ejecuta «node .runwebx/runwebx.mjs login»: te dará un código para aprobar el acceso desde tu dashboard.' });
  }
  const url = new URL(`${ctx.api}/api/tenant${ruta}`);
  for (const [k, v] of Object.entries(consulta || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  return enviar(url.toString(), { metodo, cuerpo, token: ctx.token });
}

// --------------------------------------- Resolver proyecto / base por nombre --

function elegirPorNombre(lista, ref, etiqueta) {
  const q = String(ref).toLowerCase();
  const exactos = lista.filter((x) => x.nombre.toLowerCase() === q || x.id === ref);
  const candidatos = exactos.length ? exactos : lista.filter((x) => x.nombre.toLowerCase().startsWith(q) || x.id.startsWith(ref));
  if (candidatos.length === 1) return candidatos[0].id;
  const nombres = lista.map((x) => x.nombre).join(', ') || '(ninguno)';
  if (!candidatos.length) throw new ErrorCli(`No existe ${etiqueta} «${ref}». Disponibles: ${nombres}`, { codigo: 2 });
  throw new ErrorCli(`«${ref}» es ambiguo entre ${etiqueta}s: ${candidatos.map((x) => x.nombre).join(', ')}`, { codigo: 2 });
}

/** Devuelve el id del proyecto/base: el indicado, el vinculado en .runwebx/config.json,
 * o el único que tenga la cuenta. */
async function resolverRecurso(ctx, { clave, ruta, etiqueta, opcion }) {
  const pedido = ctx.flags[clave] || ctx.config?.datos?.[clave]?.id;
  if (pedido && UUID_RE.test(pedido)) return pedido;
  const lista = await llamar(ctx, 'GET', ruta);
  if (pedido) return elegirPorNombre(lista, pedido, etiqueta);
  if (lista.length === 1) return lista[0].id;
  throw new ErrorCli(`Indica ${etiqueta} con ${opcion} <nombre>. Disponibles: ${lista.map((x) => x.nombre).join(', ') || '(ninguno)'}`, {
    codigo: 2, sugerencia: `También puedes fijarlo con «runwebx vincular ${opcion} <nombre>».`
  });
}

const resolverProyecto = (ctx) => resolverRecurso(ctx, { clave: 'proyecto', ruta: '/runver', etiqueta: 'el proyecto', opcion: '-p' });
const resolverBase = (ctx) => resolverRecurso(ctx, { clave: 'base', ruta: '/runsup', etiqueta: 'la base de datos', opcion: '-b' });

// ===== 30-catalogo.mjs =====
// ---------------------------------------------------------------------------
// Catálogo de comandos: ÚNICA fuente de verdad. De aquí salen el despachador, la ayuda
// (`runwebx ayuda --json`, que lee el agente) y la referencia del dashboard
// (public/cli/comandos.json, generada por scripts/build-cli.mjs).
//
// Campos: cmd, desc, ejemplo, modo ('lectura'|'escritura'), destructivo, pos (posicionales;
// «x?» opcional, «x...» el resto), flags (opciones propias), http [método, ruta con {pos}],
// proyecto/base (resuelven {proyecto}/{base}), consulta/cuerpo (campoApi: nombreOpcion),
// armar(a, ctx) (cuerpo/consulta a medida), especial (manejador propio), imprimir/formato.
// ---------------------------------------------------------------------------

const FLAG_ESQUEMA = { esquema: { tipo: 'str', desc: 'Schema de la base (por defecto el propio o el único con tablas)' } };

const COLUMNA_AYUDA = 'nombre:tipo[:pk][:nonulo][:unico][:def=valor]';

const CATALOGO = [
  // ---- Cuenta y sesión
  { cmd: 'login', desc: 'Inicia sesión: muestra un código que el dueño aprueba en el dashboard', especial: 'login', sinSesion: true,
    flags: { nombre: { tipo: 'str', desc: 'Nombre del equipo que verá el dueño' }, agente: { tipo: 'str', desc: 'Agente que lo usa (claude, gemini, cursor…)' },
      'sin-esperar': { tipo: 'bool', desc: 'Muestra el código y termina (para agentes con tiempo límite); luego usa --continuar' },
      continuar: { tipo: 'bool', desc: 'Termina un login iniciado con --sin-esperar' }, abrir: { tipo: 'bool', desc: 'Abre el navegador' } },
    ejemplo: 'login --agente claude' },
  { cmd: 'logout', desc: 'Borra la sesión guardada en este equipo', especial: 'logout', sinSesion: true },
  { cmd: 'whoami', desc: 'Muestra la cuenta, el plan, los permisos del acceso y su caducidad', especial: 'whoami' },
  { cmd: 'resumen', desc: 'Plan, cuotas y uso de la cuenta', modo: 'lectura', http: ['GET', '/resumen'] },
  { cmd: 'init', desc: 'Prepara este proyecto: instala el CLI, escribe las instrucciones para el agente e inicia sesión', especial: 'init', sinSesion: true,
    flags: { agentes: { tipo: 'str', desc: 'Lista separada por comas: claude,gemini,antigravity,cursor,cline,opencode,codex,copilot,windsurf,todos' },
      'sin-login': { tipo: 'bool', desc: 'No iniciar sesión ahora' }, 'sin-esperar': { tipo: 'bool', desc: 'Mostrar el código y no esperar la aprobación' },
      nombre: { tipo: 'str', desc: 'Nombre del equipo' }, abrir: { tipo: 'bool', desc: 'Abre el navegador' } },
    ejemplo: 'init --agentes claude,cursor' },
  { cmd: 'vincular', desc: 'Fija el proyecto y/o la base por defecto de esta carpeta (.runwebx/config.json)', especial: 'vincular', modo: 'lectura' },
  { cmd: 'actualizar', desc: 'Descarga la última versión del CLI en .runwebx/', especial: 'actualizar', sinSesion: true },
  { cmd: 'ayuda', desc: 'Lista los comandos (--json para agentes)', especial: 'ayuda', sinSesion: true, pos: ['comando...?'] },

  // ---- Proyectos (RunVer)
  { cmd: 'proyectos listar', desc: 'Lista los proyectos desplegados', modo: 'lectura', http: ['GET', '/runver'] },
  { cmd: 'proyectos crear', desc: 'Crea un proyecto desde un repositorio de GitHub y lo despliega', modo: 'escritura', pos: ['nombre'],
    flags: { repo: { tipo: 'str', desc: 'URL del repositorio (obligatoria)' }, rama: { tipo: 'str', desc: 'Rama (por defecto main)' },
      buildpack: { tipo: 'str', desc: 'dockerfile | nixpacks (por defecto dockerfile)' }, privado: { tipo: 'bool', desc: 'Repositorio privado (devuelve una deploy key)' } },
    http: ['POST', '/runver'], armar: (a) => {
      if (!a.flags.repo) throw new ErrorCli('Falta --repo <url del repositorio>', { codigo: 2 });
      return { cuerpo: { nombre: a.pos.nombre, repoUrl: a.flags.repo, branch: a.flags.rama, buildPack: a.flags.buildpack, esPublico: !a.flags.privado } };
    }, ejemplo: 'proyectos crear mi-web --repo https://github.com/yo/mi-web' },
  { cmd: 'proyectos estado', desc: 'Estado real del despliegue y de la aplicación', modo: 'lectura', proyecto: true, http: ['GET', '/runver/{proyecto}/estado'] },
  { cmd: 'proyectos redesplegar', desc: 'Lanza un nuevo despliegue', modo: 'escritura', proyecto: true, http: ['POST', '/runver/{proyecto}/redeploy'] },
  { cmd: 'proyectos eliminar', desc: 'Elimina el proyecto y su aplicación', modo: 'escritura', destructivo: true, proyecto: true, http: ['DELETE', '/runver/{proyecto}'] },
  { cmd: 'proyectos autodeploy', desc: 'Despliegue automático en cada push: on | off', modo: 'escritura', proyecto: true, pos: ['modo'],
    http: ['PUT', '/runver/{proyecto}/autodeploy'], armar: (a) => {
      if (!['on', 'off'].includes(a.pos.modo)) throw new ErrorCli('El modo debe ser on u off', { codigo: 2 });
      return { cuerpo: { activo: a.pos.modo === 'on' } };
    }, ejemplo: 'proyectos autodeploy on' },

  // ---- Dominio
  { cmd: 'dominio ver', desc: 'Dominio generado, dominio propio y estado del DNS (con los registros a crear)', modo: 'lectura', proyecto: true, http: ['GET', '/runver/{proyecto}/dominio'] },
  { cmd: 'dominio fijar', desc: 'Conecta un dominio propio (reinicia la aplicación)', modo: 'escritura', proyecto: true, pos: ['dominio'],
    http: ['PUT', '/runver/{proyecto}/dominio'], cuerpo: { dominio: 'dominio' }, ejemplo: 'dominio fijar midominio.com' },
  { cmd: 'dominio quitar', desc: 'Quita el dominio propio', modo: 'escritura', destructivo: true, proyecto: true, http: ['DELETE', '/runver/{proyecto}/dominio'] },

  // ---- Variables de entorno
  { cmd: 'env listar', desc: 'Variables del proyecto (valores ocultos salvo --valores)', modo: 'lectura', proyecto: true, especial: 'envListar',
    flags: { valores: { tipo: 'bool', desc: 'Muestra los valores (cuidado: son secretos)' } } },
  { cmd: 'env fijar', desc: 'Crea o actualiza variables: CLAVE=valor ...', modo: 'escritura', proyecto: true, especial: 'envFijar', pos: ['pares...'], ejemplo: 'env fijar API_URL=https://x.com' },
  { cmd: 'env borrar', desc: 'Elimina una variable', modo: 'escritura', destructivo: true, proyecto: true, especial: 'envBorrar', pos: ['clave'] },
  { cmd: 'env bajar', desc: 'Escribe las variables en un archivo local (por defecto .env.local) sin mostrarlas; lo añade a .gitignore', modo: 'lectura', proyecto: true, especial: 'envBajar', pos: ['archivo?'] },
  { cmd: 'env subir', desc: 'Sube las variables de un archivo .env al proyecto', modo: 'escritura', proyecto: true, especial: 'envSubir', pos: ['archivo'], ejemplo: 'env subir .env.local' },

  // ---- Logs, despliegues, GitHub, conexión
  { cmd: 'logs', desc: 'Logs de ejecución de la aplicación', modo: 'lectura', proyecto: true, imprimir: 'logs', http: ['GET', '/runver/{proyecto}/logs'],
    flags: { lineas: { tipo: 'num', desc: 'Líneas (1-1000, por defecto 200)' } }, consulta: { lineas: 'lineas' } },
  { cmd: 'despliegues listar', desc: 'Últimos despliegues con su estado y commit', modo: 'lectura', proyecto: true, http: ['GET', '/runver/{proyecto}/despliegues'] },
  { cmd: 'despliegues log', desc: 'Log de un despliegue, con diagnóstico de la causa si falla', modo: 'lectura', proyecto: true, pos: ['uuid'], imprimir: 'logs',
    http: ['GET', '/runver/{proyecto}/despliegues/{uuid}/logs'] },
  { cmd: 'github info', desc: 'Webhook de GitHub y modo de despliegue', modo: 'lectura', proyecto: true, http: ['GET', '/runver/{proyecto}/github'] },
  { cmd: 'github activar', desc: 'Genera el webhook y activa el despliegue automático', modo: 'escritura', proyecto: true, http: ['POST', '/runver/{proyecto}/github/activar'] },
  { cmd: 'conexion probar', desc: 'Prueba si la app conecta con su base RunSup y explica el motivo si no', modo: 'lectura', proyecto: true,
    flags: { variable: { tipo: 'str', desc: 'Variable a probar (por defecto la primera URL de Postgres)' } },
    http: ['POST', '/runver/{proyecto}/probar-conexion'], cuerpo: { key: 'variable' } },

  // ---- Bases de datos (RunSup)
  { cmd: 'db listar', desc: 'Lista las bases de datos', modo: 'lectura', http: ['GET', '/runsup'] },
  { cmd: 'db crear', desc: 'Crea una base de datos', modo: 'escritura', pos: ['nombre'], http: ['POST', '/runsup'], cuerpo: { nombre: 'nombre' } },
  { cmd: 'db eliminar', desc: 'Elimina la base y todos sus datos', modo: 'escritura', destructivo: true, base: true, http: ['DELETE', '/runsup/{base}'] },
  { cmd: 'db conexion', desc: 'Host, usuario, contraseña y cadenas de conexión (SECRETOS)', modo: 'lectura', base: true, http: ['GET', '/runsup/{base}/conexion'] },
  { cmd: 'db conectar', desc: 'Guarda la cadena de conexión de la base como variable del proyecto, sin mostrarla', modo: 'escritura', base: true, proyecto: true, especial: 'dbConectar',
    flags: { variable: { tipo: 'str', desc: 'Nombre de la variable (por defecto DATABASE_URL)' }, local: { tipo: 'str', desc: 'Escribirla también en este archivo local (p. ej. .env.local)' } },
    ejemplo: 'db conectar -b produccion -p mi-web' },
  { cmd: 'db password', desc: 'Cambia la contraseña de la base (las conexiones guardadas dejan de valer)', modo: 'escritura', destructivo: true, base: true, http: ['POST', '/runsup/{base}/password'] },
  { cmd: 'db esquemas', desc: 'Schemas visibles de la base', modo: 'lectura', base: true, http: ['GET', '/runsup/{base}/esquemas'] },
  { cmd: 'db tablas', desc: 'Tablas con columnas, índices y restricciones', modo: 'lectura', base: true, flags: FLAG_ESQUEMA,
    http: ['GET', '/runsup/{base}/tablas'], consulta: { esquema: 'esquema' } },
  { cmd: 'db filas', desc: 'Filas de una tabla (con la clave de cada fila para editarla)', modo: 'lectura', base: true, pos: ['tabla'], formato: 'filas',
    flags: { ...FLAG_ESQUEMA, pagina: { tipo: 'num', desc: 'Página desde 0' }, limite: { tipo: 'num', desc: 'Filas por página (máx 100)' },
      orden: { tipo: 'str', desc: 'Columna para ordenar' }, dir: { tipo: 'str', desc: 'asc | desc' }, q: { tipo: 'str', desc: 'Texto a buscar' } },
    http: ['GET', '/runsup/{base}/tablas/{tabla}/filas'], consulta: { esquema: 'esquema', pagina: 'pagina', limite: 'limite', orden: 'orden', dir: 'dir', q: 'q' } },
  { cmd: 'db sql', desc: 'Ejecuta UNA sentencia SQL (con acceso de lectura va en transacción READ ONLY)', modo: 'lectura', base: true, pos: ['sentencia?'], formato: 'filas',
    flags: { ...FLAG_ESQUEMA, archivo: { tipo: 'str', desc: 'Leer la sentencia de un archivo' } }, especial: 'dbSql', ejemplo: 'db sql "SELECT * FROM posts LIMIT 5"' },
  { cmd: 'db script', desc: 'Ejecuta un archivo .sql entero en UNA transacción (todo o nada)', modo: 'escritura', base: true, pos: ['archivo'], especial: 'dbScript',
    flags: FLAG_ESQUEMA, ejemplo: 'db script esquema.sql' },
  { cmd: 'db tabla crear', desc: `Crea una tabla. Columnas: --col ${COLUMNA_AYUDA}`, modo: 'escritura', base: true, pos: ['nombre'],
    flags: { ...FLAG_ESQUEMA, col: { tipo: 'multi', desc: `Columna, repetible: ${COLUMNA_AYUDA}` } },
    http: ['POST', '/runsup/{base}/tablas'], armar: (a) => {
      if (!a.flags.col?.length) throw new ErrorCli(`Indica al menos una columna con --col ${COLUMNA_AYUDA}`, { codigo: 2 });
      return { cuerpo: { esquema: a.flags.esquema, nombre: a.pos.nombre, columnas: a.flags.col.map(parsearColumna) } };
    }, ejemplo: 'db tabla crear notas --col id:serial:pk --col titulo:text:nonulo --col creada:timestamptz:def=now()' },
  { cmd: 'db tabla renombrar', desc: 'Renombra una tabla', modo: 'escritura', base: true, pos: ['tabla', 'nuevo'], flags: FLAG_ESQUEMA,
    http: ['PUT', '/runsup/{base}/tablas/{tabla}'], cuerpo: { esquema: 'esquema', nombre: 'nuevo' } },
  { cmd: 'db tabla vaciar', desc: 'Borra todas las filas de la tabla', modo: 'escritura', destructivo: true, base: true, pos: ['tabla'], flags: FLAG_ESQUEMA,
    http: ['POST', '/runsup/{base}/tablas/{tabla}/vaciar'], cuerpo: { esquema: 'esquema' } },
  { cmd: 'db tabla eliminar', desc: 'Elimina la tabla y su contenido', modo: 'escritura', destructivo: true, base: true, pos: ['tabla'], flags: FLAG_ESQUEMA,
    http: ['DELETE', '/runsup/{base}/tablas/{tabla}'], consulta: { esquema: 'esquema' } },
  { cmd: 'db columna agregar', desc: `Añade una columna: --col ${COLUMNA_AYUDA}`, modo: 'escritura', base: true, pos: ['tabla'],
    flags: { ...FLAG_ESQUEMA, col: { tipo: 'str', desc: COLUMNA_AYUDA } }, http: ['POST', '/runsup/{base}/tablas/{tabla}/columnas'],
    armar: (a) => {
      if (!a.flags.col) throw new ErrorCli(`Indica la columna con --col ${COLUMNA_AYUDA}`, { codigo: 2 });
      return { cuerpo: { esquema: a.flags.esquema, columna: parsearColumna(a.flags.col) } };
    } },
  { cmd: 'db columna modificar', desc: 'Cambia nombre, tipo, nulabilidad o valor por defecto de una columna', modo: 'escritura', base: true, pos: ['tabla', 'columna'],
    flags: { ...FLAG_ESQUEMA, nombre: { tipo: 'str', desc: 'Nuevo nombre' }, tipo: { tipo: 'str', desc: 'Nuevo tipo' }, nulo: { tipo: 'str', desc: 'si | no' },
      defecto: { tipo: 'str', desc: 'Valor por defecto, o «ninguno»' } },
    http: ['PUT', '/runsup/{base}/tablas/{tabla}/columnas/{columna}'], armar: (a) => ({ cuerpo: { esquema: a.flags.esquema, cambios: cambiosColumna(a.flags) } }) },
  { cmd: 'db columna eliminar', desc: 'Elimina una columna y sus datos', modo: 'escritura', destructivo: true, base: true, pos: ['tabla', 'columna'], flags: FLAG_ESQUEMA,
    http: ['DELETE', '/runsup/{base}/tablas/{tabla}/columnas/{columna}'], consulta: { esquema: 'esquema' } },
  { cmd: 'db fila insertar', desc: 'Inserta una fila: --set columna=valor (@nulo / @defecto para NULL o DEFAULT)', modo: 'escritura', base: true, pos: ['tabla'],
    flags: { ...FLAG_ESQUEMA, set: { tipo: 'multi', desc: 'columna=valor, repetible' } }, http: ['POST', '/runsup/{base}/tablas/{tabla}/filas'],
    armar: (a) => ({ cuerpo: { esquema: a.flags.esquema, valores: parsearAsignaciones(a.flags.set) } }), ejemplo: 'db fila insertar notas --set titulo="Hola"' },
  { cmd: 'db fila actualizar', desc: 'Actualiza una fila identificada por su clave (de «db filas»)', modo: 'escritura', base: true, pos: ['tabla'],
    flags: { ...FLAG_ESQUEMA, clave: { tipo: 'multi', desc: 'Valor de la clave primaria (uno por columna, en orden)' }, set: { tipo: 'multi', desc: 'columna=valor, repetible' } },
    http: ['PUT', '/runsup/{base}/tablas/{tabla}/filas'], armar: (a) => {
      if (!a.flags.clave?.length) throw new ErrorCli('Indica la clave de la fila con --clave <valor>', { codigo: 2 });
      return { cuerpo: { esquema: a.flags.esquema, clave: a.flags.clave, valores: parsearAsignaciones(a.flags.set) } };
    } },
  { cmd: 'db fila borrar', desc: 'Borra filas por su clave: una --clave por fila (compuestas: «v1|v2»)', modo: 'escritura', destructivo: true, base: true, pos: ['tabla'],
    flags: { ...FLAG_ESQUEMA, clave: { tipo: 'multi', desc: 'Clave de la fila, repetible' } }, http: ['DELETE', '/runsup/{base}/tablas/{tabla}/filas'],
    armar: (a) => {
      if (!a.flags.clave?.length) throw new ErrorCli('Indica al menos una fila con --clave <valor>', { codigo: 2 });
      return { cuerpo: { esquema: a.flags.esquema, claves: a.flags.clave.map((c) => c.split('|')) } };
    } },

  // ---- Escape: cualquier ruta de la API
  { cmd: 'api', desc: 'Llamada directa a /api/tenant (para lo que no tenga comando): api GET /runver', especial: 'apiDirecta', pos: ['metodo', 'ruta'],
    flags: { cuerpo: { tipo: 'str', desc: 'Cuerpo JSON' } }, ejemplo: 'api GET /resumen' },
];

// ===== 35-parseo.mjs =====
// ---------------------------------------------------------------------------
// Traducción de las opciones cómodas de la línea de comandos al JSON de la API.
// ---------------------------------------------------------------------------

const EXPRESIONES_DEFECTO = {
  'now()': 'now', now: 'now', current_timestamp: 'now',
  current_date: 'fecha_actual', 'uuid()': 'uuid', 'gen_random_uuid()': 'uuid',
  true: 'verdadero', false: 'falso', null: 'nulo',
};

/** «now()», «uuid()», «true»… son expresiones de una lista cerrada; el resto, un texto fijo. */
function parsearDefecto(valor) {
  const expresion = EXPRESIONES_DEFECTO[String(valor).toLowerCase()];
  return expresion ? { tipo: 'expresion', valor: expresion } : { tipo: 'literal', valor: String(valor) };
}

/** `nombre:tipo[:pk][:nonulo][:unico][:def=valor]` -> columna de la API.
 * El valor por defecto se lee hasta el final (puede contener «:», p. ej. una hora). */
function parsearColumna(texto) {
  const partes = String(texto).split(':');
  const [nombre, tipo] = partes;
  if (!nombre || !tipo) {
    throw new ErrorCli(`Columna inválida «${texto}». Formato: nombre:tipo[:pk][:nonulo][:unico][:def=valor]`, { codigo: 2 });
  }
  const columna = { nombre, tipo, nulo: true, pk: false, unico: false, defecto: { tipo: 'ninguno' } };
  for (let i = 2; i < partes.length; i++) {
    const m = partes[i];
    if (m === 'pk') { columna.pk = true; columna.nulo = false; }
    else if (m === 'nonulo') columna.nulo = false;
    else if (m === 'unico') columna.unico = true;
    else if (m.startsWith('def=')) { columna.defecto = parsearDefecto([m.slice(4), ...partes.slice(i + 1)].join(':')); break; }
    else throw new ErrorCli(`Modificador desconocido «${m}» en la columna «${texto}». Válidos: pk, nonulo, unico, def=valor`, { codigo: 2 });
  }
  return columna;
}

/** `--set columna=valor` (repetible). @nulo y @defecto piden NULL o el valor por defecto. */
function parsearAsignaciones(lista) {
  if (!lista?.length) throw new ErrorCli('Indica los valores con --set columna=valor', { codigo: 2 });
  const valores = {};
  for (const texto of lista) {
    const i = texto.indexOf('=');
    if (i < 1) throw new ErrorCli(`Asignación inválida «${texto}». Formato: columna=valor`, { codigo: 2 });
    const columna = texto.slice(0, i);
    const valor = texto.slice(i + 1);
    valores[columna] = valor === '@nulo' ? { modo: 'nulo' } : valor === '@defecto' ? { modo: 'defecto' } : { modo: 'valor', valor };
  }
  return valores;
}

function cambiosColumna(flags) {
  const cambios = {};
  if (flags.nombre) cambios.nombre = flags.nombre;
  if (flags.tipo) cambios.tipo = flags.tipo;
  if (flags.nulo !== undefined) {
    if (!['si', 'no'].includes(flags.nulo)) throw new ErrorCli('--nulo debe ser «si» o «no»', { codigo: 2 });
    cambios.nulo = flags.nulo === 'si';
  }
  if (flags.defecto !== undefined) cambios.defecto = flags.defecto === 'ninguno' ? { tipo: 'ninguno' } : parsearDefecto(flags.defecto);
  if (!Object.keys(cambios).length) throw new ErrorCli('Indica qué cambiar: --nombre, --tipo, --nulo o --defecto', { codigo: 2 });
  return cambios;
}

// ------------------------------------------------------------ Archivos .env --

/** Una línea KEY=VALOR de un archivo .env, con o sin comillas. */
function parsearEnv(texto) {
  const variables = [];
  for (const linea of texto.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linea);
    if (!m) continue;
    let valor = m[2].trim();
    const comilla = valor[0];
    if ((comilla === '"' || comilla === "'") && valor.length >= 2 && valor.endsWith(comilla)) {
      valor = valor.slice(1, -1);
      if (comilla === '"') valor = valor.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      valor = valor.replace(/\s+#.*$/, '');
    }
    variables.push([m[1], valor]);
  }
  return variables;
}

function lineaEnv(clave, valor) {
  if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(valor)) return `${clave}=${valor}`;
  if (!/["\\\n]/.test(valor)) return `${clave}="${valor}"`;
  if (!/['\n]/.test(valor)) return `${clave}='${valor}'`;
  return `${clave}="${valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** Mezcla variables en el texto de un .env conservando lo que ya hay (comentarios,
 * variables que solo existen en local) y el estilo de saltos de línea. */
function mezclarEnv(textoActual, variables) {
  const crlf = textoActual.includes('\r\n');
  const lineas = textoActual ? textoActual.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [];
  const pendientes = new Map(variables);
  const salida = lineas.map((linea) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(linea);
    if (!m || !pendientes.has(m[1])) return linea;
    const nueva = lineaEnv(m[1], pendientes.get(m[1]));
    pendientes.delete(m[1]);
    return nueva;
  });
  for (const [clave, valor] of pendientes) salida.push(lineaEnv(clave, valor));
  const unidos = `${salida.join('\n')}\n`;
  return crlf ? unidos.replace(/\n/g, '\r\n') : unidos;
}

// ===== 40-ejecutor.mjs =====
// ---------------------------------------------------------------------------
// Ejecutor genérico: convierte una entrada del catálogo + los argumentos en una
// llamada a la API. Los comandos con lógica propia (`especial`) viven en 41-especiales.
// ---------------------------------------------------------------------------

function opcionesDe(def) {
  return { ...FLAGS_GLOBALES, ...(def.flags || {}) };
}

function usoDe(def) {
  const pos = (def.pos || []).map((p) => {
    const sinOpcional = p.replace(/\?$/, '');
    const puntos = sinOpcional.endsWith('...') ? '...' : '';
    const nombre = sinOpcional.replace(/\.\.\.$/, '');
    return p.endsWith('?') ? `[${nombre}${puntos}]` : `<${nombre}${puntos}>`;
  });
  const opciones = Object.keys(def.flags || {}).map((n) => `[--${n}]`);
  return `runwebx ${def.cmd} ${[...pos, ...opciones].join(' ')}`.trim();
}

/** Asocia los posicionales a sus nombres según `def.pos` («x?» opcional, «x...» el resto). */
function nombrarPosicionales(def, pos) {
  const salida = {};
  let i = 0;
  for (const spec of def.pos || []) {
    const opcional = spec.endsWith('?');
    const resto = spec.replace(/\?$/, '').endsWith('...');
    const nombre = spec.replace(/\?$/, '').replace(/\.\.\.$/, '');
    if (resto) {
      salida[nombre] = pos.slice(i);
      i = pos.length;
      if (!opcional && !salida[nombre].length) throw new ErrorCli(`Faltan argumentos. Uso: ${usoDe(def)}`, { codigo: 2 });
    } else {
      if (pos[i] === undefined && !opcional) throw new ErrorCli(`Falta <${nombre}>. Uso: ${usoDe(def)}`, { codigo: 2 });
      salida[nombre] = pos[i++];
    }
  }
  if (i < pos.length) throw new ErrorCli(`Sobran argumentos: ${pos.slice(i).join(' ')}. Uso: ${usoDe(def)}`, { codigo: 2 });
  return salida;
}

function mapear(mapa, a) {
  if (!mapa) return {};
  const salida = {};
  for (const [campo, origen] of Object.entries(mapa)) {
    const valor = a.flags[origen] !== undefined ? a.flags[origen] : a.pos[origen];
    if (valor !== undefined) salida[campo] = valor;
  }
  return salida;
}

const construirRuta = (plantilla, valores) => plantilla.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(valores[k]));

async function ejecutarGenerico(def, a, ctx) {
  const valores = { ...a.pos };
  if (def.proyecto) valores.proyecto = await resolverProyecto(ctx);
  if (def.base) valores.base = await resolverBase(ctx);
  const [metodo, plantilla] = def.http;
  let consulta = mapear(def.consulta, a);
  let cuerpo = def.cuerpo ? mapear(def.cuerpo, a) : undefined;
  if (def.armar) {
    const armado = await def.armar(a, ctx);
    consulta = { ...consulta, ...(armado.consulta || {}) };
    cuerpo = armado.cuerpo !== undefined ? armado.cuerpo : cuerpo;
  }
  return llamar(ctx, metodo, construirRuta(plantilla, valores), { consulta, cuerpo });
}

function exigirConfirmacion(def, flags) {
  if (!def.destructivo || flags.confirmar) return;
  throw new ErrorCli(`«${def.cmd}» es destructivo y no se puede deshacer. No se ha ejecutado nada.`, {
    codigo: 3,
    sugerencia: 'Pide confirmación explícita al usuario y repite el comando añadiendo --confirmar.'
  });
}

async function despachar(def, a, ctx) {
  exigirConfirmacion(def, a.flags);
  if (def.especial) return ESPECIALES[def.especial](a, ctx, def);
  return ejecutarGenerico(def, a, ctx);
}

// ===== 41-especiales.mjs =====
// ---------------------------------------------------------------------------
// Comandos con lógica propia: variables de entorno, conexión de bases, SQL desde
// archivo, vinculación y utilidades. Regla común: los SECRETOS (valores de variables,
// cadenas de conexión) viajan de la plataforma a su destino sin pasar por la salida
// del CLI, para que no acaben en la conversación del agente ni en un log.
// ---------------------------------------------------------------------------

const RESERVADOS_ENV = /^(COOLIFY_|SERVICE_)/i;

function leerArchivoTexto(ruta, descripcion) {
  const absoluta = resolve(process.cwd(), ruta);
  if (!existsSync(absoluta)) throw new ErrorCli(`No existe ${descripcion}: ${ruta}`, { codigo: 2 });
  return readFileSync(absoluta, 'utf8');
}

// ------------------------------------------------------- Variables de entorno --

async function variablesDe(ctx, proyecto) {
  return llamar(ctx, 'GET', `/runver/${proyecto}/variables`);
}

async function envListar(a, ctx) {
  const proyecto = await resolverProyecto(ctx);
  const variables = await variablesDe(ctx, proyecto);
  return variables.map((v) => ({
    clave: v.key,
    valor: a.flags.valores ? v.value : ocultar(v.value),
    solo_runtime: v.is_buildtime === false,
    uuid: v.uuid,
  }));
}

function parejas(textos) {
  return textos.map((texto) => {
    const i = texto.indexOf('=');
    if (i < 1) throw new ErrorCli(`«${texto}» no es CLAVE=valor`, { codigo: 2 });
    return [texto.slice(0, i), texto.slice(i + 1)];
  });
}

async function guardarVariables(ctx, proyecto, pares) {
  const avisos = [];
  const guardadas = [];
  const omitidas = [];
  for (const [clave, valor] of pares) {
    try {
      const r = await llamar(ctx, 'PUT', `/runver/${proyecto}/variables`, { cuerpo: { key: clave, value: valor } });
      guardadas.push(clave);
      avisos.push(...(r?.avisos || []));
    } catch (err) {
      if (err.http === 401 || err.http === 403 || err.http === 429) throw err;
      omitidas.push({ clave, motivo: err.message });
    }
  }
  return { guardadas, omitidas, avisos: [...new Set(avisos)] };
}

async function envFijar(a, ctx) {
  const pares = parejas(a.pos.pares);
  const proyecto = await resolverProyecto(ctx);
  const r = await guardarVariables(ctx, proyecto, pares);
  return { ok: r.omitidas.length === 0, ...r, siguiente: 'Redespliega para aplicar los cambios: proyectos redesplegar' };
}

async function envBorrar(a, ctx) {
  const proyecto = await resolverProyecto(ctx);
  const variable = (await variablesDe(ctx, proyecto)).find((v) => v.key === a.pos.clave);
  if (!variable) throw new ErrorCli(`El proyecto no tiene la variable ${a.pos.clave}`, { codigo: 2 });
  await llamar(ctx, 'DELETE', `/runver/${proyecto}/variables/${encodeURIComponent(variable.uuid)}`);
  return { ok: true, eliminada: a.pos.clave, siguiente: 'Redespliega para aplicar los cambios: proyectos redesplegar' };
}

async function envSubir(a, ctx) {
  const pares = parsearEnv(leerArchivoTexto(a.pos.archivo, 'el archivo')).filter(([clave]) => !RESERVADOS_ENV.test(clave));
  if (!pares.length) throw new ErrorCli(`No hay variables válidas en ${a.pos.archivo}`, { codigo: 2 });
  const proyecto = await resolverProyecto(ctx);
  const r = await guardarVariables(ctx, proyecto, pares);
  return { ok: r.omitidas.length === 0, archivo: a.pos.archivo, ...r, siguiente: 'Redespliega para aplicar los cambios: proyectos redesplegar' };
}

// ------------------------------------------------- Archivos locales con secretos --

function estaIgnoradoPorGit(raiz, relativa) {
  try {
    execFileSync('git', ['check-ignore', '-q', relativa], { cwd: raiz, stdio: 'ignore' });
    return true;
  } catch (err) {
    return err.status === 1 ? false : null; // null: no hay git o no es un repositorio
  }
}

/** Un archivo con secretos nunca debe poder acabar en un commit: si git no lo ignora,
 * se añade a .gitignore (y se dice). */
function protegerEnGitignore(archivoAbsoluto) {
  const raiz = buscarConfigProyecto()?.raiz || process.cwd();
  const relativa = relative(raiz, archivoAbsoluto).split('\\').join('/');
  if (relativa.startsWith('..')) return 'fuera del proyecto';
  if (estaIgnoradoPorGit(raiz, relativa) === true) return 'ya ignorado por git';
  const ruta = join(raiz, '.gitignore');
  const actual = existsSync(ruta) ? readFileSync(ruta, 'utf8') : '';
  if (actual.split(/\r?\n/).map((l) => l.trim()).includes(relativa)) return 'ya ignorado por git';
  writeFileSync(ruta, `${actual}${actual && !actual.endsWith('\n') ? '\n' : ''}# RunWebX: variables con secretos\n${relativa}\n`);
  return 'añadido a .gitignore';
}

function escribirEnvLocal(archivo, pares) {
  const absoluto = resolve(process.cwd(), archivo);
  const actual = existsSync(absoluto) ? readFileSync(absoluto, 'utf8') : '';
  writeFileSync(absoluto, mezclarEnv(actual, pares), { mode: 0o600 });
  return { archivo, gitignore: protegerEnGitignore(absoluto) };
}

async function envBajar(a, ctx) {
  const proyecto = await resolverProyecto(ctx);
  const variables = await variablesDe(ctx, proyecto);
  const local = escribirEnvLocal(a.pos.archivo || '.env.local', variables.map((v) => [v.key, v.value]));
  return { ok: true, ...local, variables: variables.map((v) => v.key), nota: 'Los valores se escribieron en el archivo y no se muestran aquí.' };
}

// ---------------------------------------------------------------- Bases de datos --

async function dbConectar(a, ctx) {
  const base = await resolverBase(ctx);
  const proyecto = await resolverProyecto(ctx);
  const variable = a.flags.variable || 'DATABASE_URL';
  const datos = await llamar(ctx, 'GET', `/runsup/${base}/conexion`);
  const r = await llamar(ctx, 'PUT', `/runver/${proyecto}/variables`, { cuerpo: { key: variable, value: datos.connectionStringInterna } });
  const resultado = { ok: true, variable, base, proyecto, avisos: r?.avisos || [], siguiente: 'Redespliega para aplicar el cambio y comprueba con: conexion probar' };
  if (a.flags.local) resultado.local = escribirEnvLocal(a.flags.local, [[variable, datos.connectionStringInterna]]);
  return resultado;
}

async function dbSql(a, ctx) {
  const sql = a.pos.sentencia ?? (a.flags.archivo ? leerArchivoTexto(a.flags.archivo, 'el archivo SQL') : null);
  if (!sql) throw new ErrorCli('Indica la sentencia: db sql "SELECT 1" o --archivo consulta.sql', { codigo: 2 });
  const base = await resolverBase(ctx);
  return llamar(ctx, 'POST', `/runsup/${base}/sql`, { cuerpo: { sql, esquema: a.flags.esquema } });
}

async function dbScript(a, ctx) {
  const sql = leerArchivoTexto(a.pos.archivo, 'el archivo SQL');
  const base = await resolverBase(ctx);
  return llamar(ctx, 'POST', `/runsup/${base}/sql/script`, { cuerpo: { sql, esquema: a.flags.esquema } });
}

// ---------------------------------------------------------------- Utilidades --

async function vincular(a, ctx) {
  const cambios = {};
  if (a.flags.proyecto) {
    const id = await resolverProyecto(ctx);
    cambios.proyecto = { id, nombre: (await llamar(ctx, 'GET', '/runver')).find((p) => p.id === id)?.nombre };
  }
  if (a.flags.base) {
    const id = await resolverBase(ctx);
    cambios.base = { id, nombre: (await llamar(ctx, 'GET', '/runsup')).find((b) => b.id === id)?.nombre };
  }
  if (!Object.keys(cambios).length) return { vinculado: ctx.config?.datos?.proyecto || null, base: ctx.config?.datos?.base || null };
  const archivo = guardarConfigProyecto(cambios, ctx.config?.raiz || process.cwd());
  return { ok: true, archivo, ...cambios };
}

async function whoami(a, ctx) {
  const [acceso, resumen] = await Promise.all([llamar(ctx, 'GET', '/cli/yo'), llamar(ctx, 'GET', '/resumen')]);
  return { api: ctx.api, email: resumen.usuario?.email, empresa: resumen.tenant?.nombre_empresa, plan: resumen.tenant?.plan, acceso, cuotas: resumen.cuotas };
}

async function apiDirecta(a, ctx) {
  const metodo = String(a.pos.metodo).toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo)) throw new ErrorCli('El método debe ser GET, POST, PUT, PATCH o DELETE', { codigo: 2 });
  if (!a.pos.ruta.startsWith('/') || a.pos.ruta.includes('..')) throw new ErrorCli('La ruta debe empezar por / (relativa a /api/tenant)', { codigo: 2 });
  let cuerpo;
  if (a.flags.cuerpo !== undefined) {
    try { cuerpo = JSON.parse(a.flags.cuerpo); } catch { throw new ErrorCli('--cuerpo debe ser JSON válido', { codigo: 2 }); }
  }
  if (metodo === 'DELETE' && !a.flags.confirmar) {
    throw new ErrorCli('Un DELETE directo es destructivo. No se ha ejecutado nada.', { codigo: 3, sugerencia: 'Con autorización explícita del usuario, repite con --confirmar.' });
  }
  return llamar(ctx, metodo, a.pos.ruta, { cuerpo });
}

const ESPECIALES = {
  envListar, envFijar, envBorrar, envBajar, envSubir,
  dbConectar, dbSql, dbScript,
  vincular, whoami, apiDirecta,
  // login, logout, init, actualizar y ayuda se registran en sus propios módulos.
};

// ===== 50-login.mjs =====
// ---------------------------------------------------------------------------
// Inicio de sesión por código (el dueño aprueba el acceso en su dashboard).
//
// El CLI genera un secreto aleatorio y envía a la plataforma SOLO su SHA-256. Cuando el
// dueño aprueba, ese mismo secreto pasa a ser el token: nunca viaja en claro por la red
// ni lo conoce la plataforma, y nadie tiene que copiar ni pegar una contraseña.
// ---------------------------------------------------------------------------

const sondeoMs = (intervaloServidor) => Number(process.env.RUNWEBX_SONDEO_MS) || Math.max(2, intervaloServidor || 3) * 1000;
const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');

function abrirNavegador(url) {
  const [orden, argumentos] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(orden, argumentos, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* es solo una comodidad */ }
}

function mostrarCodigo(pendiente, abrir) {
  aviso('');
  aviso('Para dar acceso a RunWebX a este equipo, el dueño de la cuenta tiene que aprobarlo:');
  aviso(`  1. Abre:  ${pendiente.url}`);
  aviso(`  2. Comprueba que el código es  ${pendiente.codigo}  y pulsa «Aprobar».`);
  aviso(`El código caduca en ${Math.round((pendiente.expira - Date.now()) / 60000)} minutos. Esperando la aprobación...`);
  aviso('');
  if (abrir) abrirNavegador(pendiente.url);
}

async function iniciarLogin(ctx, opciones) {
  const token = `rwx_${randomBytes(32).toString('base64url')}`;
  const nombre = opciones.nombre || `${userInfo().username}@${hostname()}`;
  const agente = opciones.agente || process.env.RUNWEBX_AGENTE || null;
  const r = await enviar(`${ctx.api}/api/cli/dispositivo`, { metodo: 'POST', cuerpo: { nombre, agente, token_hash: sha256(token) } });
  const pendiente = {
    api: ctx.api, device_code: r.device_code, codigo: r.user_code, url: r.verification_uri_completa,
    token, nombre, expira: Date.now() + r.expires_in * 1000, intervalo: r.interval,
  };
  escribirJsonPrivado(archivoPendiente(), pendiente);
  mostrarCodigo(pendiente, opciones.abrir);
  return pendiente;
}

async function esperarAprobacion(ctx, pendiente) {
  let espera = sondeoMs(pendiente.intervalo);
  while (Date.now() < pendiente.expira) {
    await esperar(espera);
    let estado;
    try {
      estado = await enviar(`${ctx.api}/api/cli/dispositivo/consultar`, { metodo: 'POST', cuerpo: { device_code: pendiente.device_code } });
    } catch (err) {
      if (err.http === 429) { espera += 2000; continue; }
      if (err.http === 404) throw new ErrorCli('La plataforma ya no conoce esta solicitud. Ejecuta «login» de nuevo.', { codigo: 2 });
      throw err;
    }
    if (estado.estado === 'aprobado') return estado;
    if (estado.estado === 'denegado') throw new ErrorCli('El dueño de la cuenta ha rechazado el acceso.', { codigo: 2 });
    if (estado.estado === 'expirado' || estado.estado === 'revocado') break;
  }
  throw new ErrorCli('El código caducó antes de que se aprobara. Ejecuta «login» de nuevo.', { codigo: 2 });
}

function terminarLogin(pendiente, estado) {
  guardarCredenciales(pendiente.api, {
    token: pendiente.token, permisos: estado.permisos, expira_en: estado.token_expira_en, email: estado.email, nombre: pendiente.nombre,
  });
  try { unlinkSync(archivoPendiente()); } catch { /* ya no existe */ }
  return { ok: true, email: estado.email, permisos: estado.permisos, expira_en: estado.token_expira_en, equipo: pendiente.nombre };
}

async function login(a, ctx) {
  let pendiente;
  if (a.flags.continuar) {
    pendiente = leerJson(archivoPendiente());
    if (!pendiente || pendiente.api !== ctx.api) throw new ErrorCli('No hay un login pendiente. Ejecuta «login» primero.', { codigo: 2 });
    mostrarCodigo(pendiente, false);
  } else {
    pendiente = await iniciarLogin(ctx, { nombre: a.flags.nombre, agente: a.flags.agente, abrir: a.flags.abrir });
    if (a.flags['sin-esperar']) {
      return { ok: true, pendiente: true, codigo: pendiente.codigo, url: pendiente.url, siguiente: 'Cuando el dueño apruebe, ejecuta: login --continuar' };
    }
  }
  return terminarLogin(pendiente, await esperarAprobacion(ctx, pendiente));
}

async function logout(a, ctx) {
  const existia = borrarCredenciales(ctx.api);
  return {
    ok: true, sesion_local_borrada: existia,
    nota: 'El acceso sigue vigente en RunWebX hasta que caduque o lo revoques en el dashboard (menú «Runwebx CLI»).',
  };
}

Object.assign(ESPECIALES, { login, logout });

// ===== 60-agentes.mjs =====
// ---------------------------------------------------------------------------
// `init`: deja el proyecto listo para que CUALQUIER agente use RunWebX.
//   1. Copia el CLI a .runwebx/runwebx.mjs (así funciona sin PATH ni instalación global).
//   2. Escribe un bloque de instrucciones en los archivos que leen los agentes
//      (AGENTS.md y los de cada herramienta), entre marcas para poder actualizarlo.
//   3. Inicia sesión (el dueño aprueba el código en su dashboard).
// ---------------------------------------------------------------------------

const MARCA_INICIO = '<!-- runwebx:inicio -->';
const MARCA_FIN = '<!-- runwebx:fin -->';
const COMANDO_CLI = 'node .runwebx/runwebx.mjs';

// Archivo(s) de instrucciones que lee cada herramienta.
const OBJETIVOS_AGENTE = {
  claude: ['CLAUDE.md'],
  gemini: ['GEMINI.md'],
  antigravity: ['AGENTS.md', 'GEMINI.md'],
  opencode: ['AGENTS.md'],
  codex: ['AGENTS.md'],
  cursor: ['.cursor/rules/runwebx.mdc'],
  cline: ['.clinerules'],
  copilot: ['.github/copilot-instructions.md'],
  windsurf: ['.windsurfrules'],
};
// Si ya existen en el proyecto, se actualizan aunque no se haya pedido ese agente.
const ARCHIVOS_SI_EXISTEN = ['CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', '.windsurfrules', '.cursorrules'];

function bloqueInstrucciones() {
  return `${MARCA_INICIO}
## RunWebX CLI — gestión de la infraestructura de este proyecto

Este proyecto se despliega en RunWebX. Para proyectos, dominio, variables de entorno, logs,
despliegues, GitHub y bases de datos usa el CLI local. NO pidas contraseñas ni claves al usuario.

    ${COMANDO_CLI} <comando> [opciones]

- Descubre los comandos: \`${COMANDO_CLI} ayuda\` (o \`ayuda --json\`). Sin terminal, la salida es JSON.
- Sin sesión: \`${COMANDO_CLI} login\` muestra un enlace y un código. Díselo al usuario para que lo apruebe en su
  dashboard y deja el comando esperando. Si tu herramienta limita el tiempo de los comandos, usa
  \`login --sin-esperar\` y después \`login --continuar\`.
- Comprueba la cuenta, el plan y los permisos del acceso: \`${COMANDO_CLI} whoami\`.

Reglas:
1. Las operaciones destructivas (eliminar, vaciar, borrar filas o columnas, quitar dominio, cambiar la contraseña
   de una base) se niegan sin \`--confirmar\`. Usa \`--confirmar\` SOLO si el usuario lo ha autorizado explícitamente
   en esta conversación para esa operación concreta.
2. Nunca escribas secretos (contraseñas, cadenas de conexión, tokens) en la conversación, en el código ni en commits.
   Para conectar una base a un proyecto usa \`db conectar\`; para tener las variables en local, \`env bajar\`.
   Ambos mueven el valor sin mostrarlo.
3. Antes de cambiar la estructura de una base, inspecciónala (\`db tablas\`, \`db filas\`). Los cambios sobre datos de
   producción los confirma el usuario.
4. Los cambios de variables solo se aplican al redesplegar: \`proyectos redesplegar\`.
5. Si un despliegue falla: \`despliegues listar\` y luego \`despliegues log <uuid>\` (incluye un diagnóstico de la causa).
6. Si la aplicación no conecta con su base: \`conexion probar\` explica el motivo.
${MARCA_FIN}`;
}

const escaparRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Inserta o actualiza el bloque en un archivo de texto sin tocar el resto. */
function escribirBloque(ruta, bloque, cabecera = '') {
  const existe = existsSync(ruta);
  const original = existe ? readFileSync(ruta, 'utf8') : '';
  const crlf = original.includes('\r\n');
  const texto = original.replace(/\r\n/g, '\n');
  const patron = new RegExp(`${escaparRegex(MARCA_INICIO)}[\\s\\S]*?${escaparRegex(MARCA_FIN)}`);
  let nuevo;
  let accion;
  if (patron.test(texto)) { nuevo = texto.replace(patron, () => bloque); accion = 'actualizado'; }
  else if (texto.trim()) { nuevo = `${texto.replace(/\s*$/, '')}\n\n${bloque}\n`; accion = 'añadido'; }
  else { nuevo = `${cabecera}${bloque}\n`; accion = existe ? 'añadido' : 'creado'; }
  if (nuevo === texto) return 'sin cambios';
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, crlf ? nuevo.replace(/\n/g, '\r\n') : nuevo);
  return accion;
}

const CABECERA_CURSOR = '---\ndescription: Gestión de la infraestructura del proyecto con el CLI de RunWebX\nalwaysApply: true\n---\n\n';

function rutaObjetivo(raiz, relativaArchivo) {
  const ruta = join(raiz, relativaArchivo);
  // Cline admite .clinerules como archivo o como carpeta de reglas.
  if (relativaArchivo === '.clinerules' && existsSync(ruta) && statSync(ruta).isDirectory()) return join(ruta, 'runwebx.md');
  return ruta;
}

function listaDeArchivos(raiz, agentes) {
  const elegidos = new Set(['AGENTS.md']);
  const lista = agentes === 'todos' ? Object.keys(OBJETIVOS_AGENTE) : String(agentes || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const agente of lista) {
    if (!OBJETIVOS_AGENTE[agente]) throw new ErrorCli(`Agente desconocido «${agente}». Válidos: ${Object.keys(OBJETIVOS_AGENTE).join(', ')}, todos`, { codigo: 2 });
    OBJETIVOS_AGENTE[agente].forEach((f) => elegidos.add(f));
  }
  ARCHIVOS_SI_EXISTEN.filter((f) => existsSync(join(raiz, f))).forEach((f) => elegidos.add(f));
  return [...elegidos];
}

function escribirInstrucciones(raiz, agentes) {
  const bloque = bloqueInstrucciones();
  return listaDeArchivos(raiz, agentes).map((f) => ({
    archivo: f,
    accion: escribirBloque(rutaObjetivo(raiz, f), bloque, f.endsWith('.mdc') ? CABECERA_CURSOR : ''),
  }));
}

// ------------------------------------------------------------ Copia del CLI --

const FIRMA_CLI = 'RunWebX CLI v';

const FIN_CLI = 'await principal(process.argv)';

/** El código del CLI. Para instalar: el propio archivo en ejecución o, si se lanzó por
 * stdin (`curl … | node -`), una descarga. Para actualizar siempre se descarga (leerse a
 * sí mismo no actualizaría nada). Se rechaza lo que no parezca un CLI completo. */
async function obtenerFuenteCli(api, { descargar = false } = {}) {
  if (!descargar) {
    try {
      const propio = readFileSync(fileURLToPath(import.meta.url), 'utf8');
      if (propio.includes(FIRMA_CLI)) return propio;
    } catch { /* se ejecuta desde stdin: no hay archivo */ }
  }
  const res = await fetch(`${api}/cli/runwebx.mjs`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  const texto = res?.ok ? await res.text() : '';
  if (!texto.includes(FIRMA_CLI) || !texto.includes(FIN_CLI)) {
    throw new ErrorCli(`No se pudo descargar el CLI desde ${api}/cli/runwebx.mjs`, { codigo: 1, sugerencia: 'Comprueba la conexión y la URL de la plataforma (--api).' });
  }
  return texto;
}

function versionDe(texto) {
  return /const VERSION = '([^']+)'/.exec(texto)?.[1] || null;
}

/** Un CLI roto dejaría sin herramientas al agente: antes de sustituir el actual se
 * comprueba que el nuevo arranca y dice la versión esperada. */
function verificarArranque(archivo, version) {
  let salida = '';
  try { salida = execFileSync(process.execPath, [archivo, '--version'], { encoding: 'utf8', timeout: 10_000 }).trim(); } catch { /* se trata abajo */ }
  if (salida !== version) {
    try { unlinkSync(archivo); } catch { /* ya no está */ }
    throw new ErrorCli('El CLI descargado no arranca; se conserva la versión actual.', { codigo: 1 });
  }
}

async function instalarCli(raiz, api, { descargar = false } = {}) {
  const destino = join(raiz, DIR_PROYECTO, 'runwebx.mjs');
  const anterior = existsSync(destino) ? readFileSync(destino, 'utf8') : null;
  const fuente = await obtenerFuenteCli(api, { descargar });
  const esElMismo = (() => { try { return resolve(fileURLToPath(import.meta.url)) === resolve(destino); } catch { return false; } })();
  if (!esElMismo || descargar) {
    mkdirSync(dirname(destino), { recursive: true });
    const temporal = `${destino}.${process.pid}.tmp.mjs`;
    writeFileSync(temporal, fuente);
    if (descargar) verificarArranque(temporal, versionDe(fuente));
    renameSync(temporal, destino);
  }
  return { archivo: `${DIR_PROYECTO}/runwebx.mjs`, version: versionDe(fuente), anterior: versionDe(anterior || '') };
}

async function actualizar(a, ctx) {
  const raiz = ctx.config?.raiz || process.cwd();
  const r = await instalarCli(raiz, ctx.api, { descargar: true });
  return { ok: true, ...r, cambio: r.anterior !== r.version };
}

// ----------------------------------------------------------------------- init --

async function sesionVigente(ctx) {
  if (!ctx.token) return false;
  try { await llamar(ctx, 'GET', '/cli/yo'); return true; } catch { return false; }
}

async function init(a, ctx) {
  const raiz = process.cwd();
  const cli = await instalarCli(raiz, ctx.api);
  guardarConfigProyecto({ ...(ctx.api !== API_POR_DEFECTO ? { api: ctx.api } : {}), cli: cli.version }, raiz);
  const instrucciones = escribirInstrucciones(raiz, a.flags.agentes);
  const resultado = { ok: true, carpeta: raiz, cli, instrucciones };
  aviso(`CLI instalado en ${cli.archivo} (v${cli.version}). Instrucciones para agentes: ${instrucciones.map((i) => `${i.archivo} (${i.accion})`).join(', ')}.`);
  if (a.flags['sin-login']) return { ...resultado, sesion: 'omitida' };
  if (await sesionVigente(ctx)) return { ...resultado, sesion: 'ya iniciada' };
  const agente = String(a.flags.agentes || '').split(',')[0] || undefined;
  const login_ = await ESPECIALES.login({ flags: { nombre: a.flags.nombre, agente, abrir: a.flags.abrir, 'sin-esperar': a.flags['sin-esperar'] } }, ctx);
  return { ...resultado, sesion: login_ };
}

Object.assign(ESPECIALES, { init, actualizar });

// ===== 90-principal.mjs =====
// ---------------------------------------------------------------------------
// Ayuda y punto de entrada.
// ---------------------------------------------------------------------------

function resumenComando(def) {
  return {
    comando: def.cmd,
    descripcion: def.desc,
    permiso: def.modo || null,
    destructivo: Boolean(def.destructivo),
    posicionales: def.pos || [],
    opciones: Object.fromEntries(Object.entries(def.flags || {}).map(([n, s]) => [`--${n}`, { tipo: s.tipo, descripcion: s.desc }])),
    necesita_proyecto: Boolean(def.proyecto),
    necesita_base: Boolean(def.base),
    ruta_api: def.http ? `${def.http[0]} ${def.http[1]}` : null,
    ejemplo: def.ejemplo ? `runwebx ${def.ejemplo}` : null,
  };
}

function ayudaJson() {
  return {
    version: VERSION,
    uso: `${COMANDO_CLI} <comando> [opciones]`,
    opciones_globales: Object.fromEntries(Object.entries(FLAGS_GLOBALES).map(([n, s]) => [`--${n}${s.alias ? ` (-${s.alias})` : ''}`, s.desc])),
    notas: [
      'Sin terminal la salida es JSON; los avisos y el progreso van por stderr.',
      'Los comandos marcados destructivo se niegan sin --confirmar: úsalo solo con autorización explícita del usuario.',
      'Un acceso de solo lectura puede ejecutar los comandos con permiso «lectura».',
    ],
    comandos: CATALOGO.map(resumenComando),
  };
}

function ayudaTexto(filtro) {
  const lista = filtro ? CATALOGO.filter((d) => d.cmd === filtro || d.cmd.startsWith(`${filtro} `)) : CATALOGO;
  const ancho = Math.max(...lista.map((d) => d.cmd.length));
  const lineas = lista.map((d) => `  ${d.cmd.padEnd(ancho)}  ${d.destructivo ? '[!] ' : ''}${d.desc}`);
  const cabecera = filtro ? '' : `RunWebX CLI v${VERSION} — gestiona tu infraestructura desde la terminal o desde tu agente de desarrollo\n\nUso: ${COMANDO_CLI} <comando> [opciones]\n\n`;
  const pie = filtro ? '' : '\n[!] = destructivo: exige --confirmar.  Opciones globales: --json --texto -p/--proyecto -b/--base --api --ayuda\nDetalle de un comando: ayuda <comando>   ·   Para agentes: ayuda --json';
  return `${cabecera}${lineas.join('\n')}${pie}`;
}

function ayudaDeComando(def) {
  const opciones = Object.entries({ ...(def.flags || {}) }).map(([n, s]) => `  --${n.padEnd(12)} ${s.desc || ''}`);
  return [`${def.cmd} — ${def.desc}`, `Uso: ${usoDe(def)}`, def.destructivo ? 'Destructivo: exige --confirmar.' : null,
    opciones.length ? `Opciones:\n${opciones.join('\n')}` : null, def.ejemplo ? `Ejemplo: runwebx ${def.ejemplo}` : null].filter(Boolean).join('\n');
}

ESPECIALES.ayuda = async (a, ctx) => {
  const filtro = (a.pos.comando || []).join(' ');
  if (modoJson(a.flags)) {
    const todo = ayudaJson();
    return filtro ? { ...todo, comandos: todo.comandos.filter((c) => c.comando === filtro || c.comando.startsWith(`${filtro} `)) } : todo;
  }
  const exacto = CATALOGO.find((d) => d.cmd === filtro);
  return exacto ? ayudaDeComando(exacto) : ayudaTexto(filtro);
};

// ------------------------------------------------------------------- Entrada --

function buscarComando(tokens) {
  const palabras = [];
  for (const t of tokens) { if (t.startsWith('-')) break; palabras.push(t.toLowerCase()); }
  let mejor = null;
  for (const def of CATALOGO) {
    const partes = def.cmd.split(' ');
    const coincide = partes.length <= palabras.length && partes.every((p, i) => p === palabras[i]);
    if (coincide && (!mejor || partes.length > mejor.n)) mejor = { def, n: partes.length };
  }
  return mejor;
}

function comandoDesconocido(tokens) {
  const palabras = tokens.filter((t) => !t.startsWith('-'));
  const grupo = String(palabras[0] || '').toLowerCase();
  if (CATALOGO.some((d) => d.cmd.startsWith(`${grupo} `))) {
    process.stdout.write(`${ayudaTexto(grupo)}\n`);
    return 2;
  }
  const parecidos = CATALOGO.filter((d) => d.cmd.startsWith(grupo.slice(0, 3))).map((d) => d.cmd).slice(0, 5);
  throw new ErrorCli(`Comando desconocido: ${palabras.join(' ')}`, { codigo: 2, sugerencia: `${parecidos.length ? `¿Quizá: ${parecidos.join(', ')}? ` : ''}Lista completa: ${COMANDO_CLI} ayuda` });
}

async function principal(argv) {
  const tokens = argv.slice(2);
  let flags = { json: tokens.includes('--json'), texto: tokens.includes('--texto') };
  try {
    if (tokens[0] === '--version' || tokens[0] === '-v') { process.stdout.write(`${VERSION}\n`); return 0; }
    if (!tokens.length || tokens[0] === '--ayuda' || tokens[0] === '-h') { process.stdout.write(`${ayudaTexto()}\n`); return 0; }
    const encontrado = buscarComando(tokens);
    if (!encontrado) return comandoDesconocido(tokens);
    const { def, n } = encontrado;
    const a = parsearArgumentos(tokens.slice(n), opcionesDe(def));
    flags = a.flags;
    if (flags.ayuda) { process.stdout.write(`${ayudaDeComando(def)}\n`); return 0; }
    a.pos = nombrarPosicionales(def, a.pos);
    const ctx = crearContexto(flags);
    imprimir(await despachar(def, a, ctx), flags, def);
    return 0;
  } catch (err) {
    return imprimirError(err, flags);
  }
}

process.exitCode = await principal(process.argv);
