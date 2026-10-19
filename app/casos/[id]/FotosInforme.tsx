"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchivoMeta } from "@/lib/caso/repositorio";
import { BotonIcono, Icono } from "@/components/Iconos";
import { esEdicionNula } from "@/lib/fotos/recorte";
import { soltarFoto } from "@/lib/fotos/orden";
import { FOTO_TAMANO_TEXTO, FOTO_ALTO_CM, FOTO_ANCHO_CM } from "@/lib/domain/constantes";
import EditorFoto from "./EditorFoto";
import TituloAyuda from "@/components/Ayuda";
import ImagenParaCopiar from "@/components/ImagenParaCopiar";
import { copiarImagen, ErrorPortapapeles } from "@/lib/docs/portapapeles";

type Props = {
  casoId: string;
  fotos: ArchivoMeta[];
  enInforme: string[];
  leyendasGrupos: Record<string, string>;
  /** Hay un informe generado y está al día con todos los cambios. */
  alDia: boolean;
  hayInforme: boolean;
  puedeGenerar: boolean;
  generando: boolean;
  onRegenerar: () => Promise<void>;
};

/**
 * Galería de las fotos del caso. Parte con marcadas las que el sistema pone en el informe. El orden y la selección de cada estancia se
 * trabajan en un borrador: «Actualizar» lo aplica al informe y al anexo; si el usuario sale sin actualizar, se descarta. Recortar una foto o
 * escribir la leyenda del grupo se guarda al momento. Con cambios pendientes cada bloque ofrece Actualizar y Volver a generar el informe.
 */
/** Cambia cuando cambia la edición de la foto: así el navegador no muestra una miniatura vieja. */
const versionDe = (e: unknown): string => {
  const s = JSON.stringify(e ?? null);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

export default function FotosInforme({ casoId, fotos, enInforme, leyendasGrupos, alDia, hayInforme, puedeGenerar, generando, onRegenerar }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState<ArchivoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [respaldo, setRespaldo] = useState<Blob | null>(null);
  const [pies, setPies] = useState<Record<string, string>>(leyendasGrupos);
  const [borrador, setBorrador] = useState<Record<string, string[]>>({});
  const [arrastre, setArrastre] = useState<{ id: string; recinto: string } | null>(null); // foto que se está arrastrando para cambiar su posición
  const [sobre, setSobre] = useState<string | null>(null);
  const [tocados, setTocados] = useState<string[]>([]); // estancias con fotos editadas o leyenda guardada en esta sesión
  const marcarTocado = (recinto: string) => setTocados((t) => (t.includes(recinto) ? t : [...t, recinto]));

  /** Copia la foto tal como irá al informe (recorte de ${FOTO_TAMANO_TEXTO}, con su edición) al portapapeles, sin descargar nada. */
  async function copiarFoto(f: ArchivoMeta) {
    setCopiado(null);
    setRespaldo(null);
    setError(null);
    const png = fetch(`/api/casos/${casoId}/archivos/${f.id}?copia=1`).then(async (r) => {
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo preparar la foto");
      return r.blob();
    });
    try {
      await copiarImagen(png);
      setCopiado(`Foto copiada (${FOTO_TAMANO_TEXTO}): pégala donde la necesites.`);
    } catch (e) {
      if (e instanceof ErrorPortapapeles && e.imagen) setRespaldo(e.imagen);
      else setError(e instanceof Error ? e.message : "No se pudo copiar la foto");
    }
  }

  async function descartarEdicion(f: ArchivoMeta) {
    setOcupado(f.id);
    setError(null);
    const r = await fetch(`/api/casos/${casoId}/archivos/${f.id}/edicion`, { method: "DELETE" });
    setOcupado(null);
    if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar");
    marcarTocado(f.recinto ?? "Sin recinto");
    router.refresh();
  }

  /** La leyenda del grupo se guarda sola al salir del campo; los documentos se rehacen después con «Actualizar informe». */
  async function guardarPie(recinto: string, texto: string): Promise<boolean> {
    const r = await fetch(`/api/casos/${casoId}/fotos-grupos`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recinto, leyenda: texto, diferir: true }) });
    if (!r.ok) {
      setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar la leyenda");
      return false;
    }
    marcarTocado(recinto);
    router.refresh();
    return true;
  }

  if (fotos.length === 0) return null;
  const porRecinto = new Map<string, ArchivoMeta[]>();
  for (const f of fotos) porRecinto.set(f.recinto ?? "Sin recinto", [...(porRecinto.get(f.recinto ?? "Sin recinto") ?? []), f]);
  const baseDe = (recinto: string) => enInforme.filter((id) => porRecinto.get(recinto)?.some((f) => f.id === id));
  const actualDe = (recinto: string) => borrador[recinto] ?? baseDe(recinto);
  const hayBorrador = (recinto: string) => !!borrador[recinto] && borrador[recinto].join() !== baseDe(recinto).join();
  const pendientes = [...porRecinto.keys()].filter(hayBorrador);

  const editarBorrador = (recinto: string, f: (ids: string[]) => string[]) => setBorrador((b) => ({ ...b, [recinto]: f(b[recinto] ?? baseDe(recinto)) }));
  const mover = (recinto: string, id: string, delta: -1 | 1) =>
    editarBorrador(recinto, (ids) => {
      const i = ids.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ids.length) return ids;
      const n = [...ids];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  /** Arrastrar y soltar: la foto arrastrada ocupa el lugar de la de destino (si no iba al informe, entra en esa posición). Solo dentro de la misma estancia. */
  const soltar = (recinto: string, destino: string) => {
    const a = arrastre;
    setArrastre(null);
    setSobre(null);
    if (!a || a.recinto !== recinto || a.id === destino) return;
    editarBorrador(recinto, (ids) => soltarFoto(ids, a.id, destino));
  };
  const alternar = (recinto: string, id: string) => editarBorrador(recinto, (ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  /** Guarda el borrador de una estancia (qué fotos van y en qué orden) sin rehacer todavía los documentos. */
  async function guardarBorrador(recinto: string): Promise<boolean> {
    const ids = actualDe(recinto);
    const quitar = baseDe(recinto).filter((id) => !ids.includes(id));
    const r = await fetch(`/api/casos/${casoId}/fotos-orden`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, quitar, diferir: true }) });
    if (!r.ok) {
      setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar el orden de las fotos");
      return false;
    }
    setBorrador((b) => {
      const { [recinto]: _quitado, ...resto } = b;
      void _quitado;
      return resto;
    });
    marcarTocado(recinto);
    return true;
  }

  /** Un solo botón: guarda todo lo pendiente (orden y selección de todas las estancias y las leyendas) y rehace el informe, el anexo, el PDF y el ZIP en cascada. */
  async function actualizarInforme() {
    setOcupado("cascada");
    setError(null);
    for (const recinto of pendientes) if (!(await guardarBorrador(recinto))) return setOcupado(null);
    for (const [recinto, texto] of Object.entries(pies)) if ((leyendasGrupos[recinto] ?? "") !== texto.trim() && !(await guardarPie(recinto, texto))) return setOcupado(null);
    setOcupado(null);
    await onRegenerar();
  }

  const va = new Set([...porRecinto.keys()].flatMap(actualDe));
  const editadas = fotos.filter((f) => f.edicion && !esEdicionNula(f.edicion)).length;

  return (
    <div className="panel space-y-3 p-5">
      <TituloAyuda titulo="Fotografías del informe" nivel={3}>
        <p>
          Cada foto se inserta en un marco de {FOTO_TAMANO_TEXTO} (tabla de {FOTO_ANCHO_CM * 2} cm). Ya vienen marcadas con ✓ las que el sistema pone en el informe (las de los recintos con daño, hasta 6 por recinto).
          Desmarca las que no quieras, marca otras y arrastra cada foto a su lugar (o usa las flechas ← →) para cambiar su posición dentro de la estancia (1, 2, 3… de izquierda a derecha).
        </p>
        <p>
          Esos cambios quedan en un borrador: el botón «Actualizar informe» los aplica todos juntos (con las leyendas y las fotos editadas) al informe, al anexo, al PDF y al ZIP. Si sales sin actualizar, el orden y la selección se descartan; la leyenda del grupo se guarda sola al salir del campo.
          Cada grupo lleva el nombre de su estancia y puedes escribirle una leyenda al pie. El anexo lleva las mismas fotos del informe, en el mismo orden. La leyenda de cada foto es opcional: sin texto no sale ninguna.
        </p>
      </TituloAyuda>
      <p role="status" className="text-sm text-[color:var(--texto)]">
        <strong>{va.size}</strong> en el informe · <strong>{editadas}</strong> con recorte editado · {fotos.length} en total
      </p>
      {pendientes.length > 0 && (
        <p role="status" className="aviso aviso-alerta">
          Hay cambios sin aplicar en {pendientes.join(", ")}. El informe todavía no los refleja: pulsa «Actualizar informe» o se descartarán al salir.
        </p>
      )}
      {(pendientes.length > 0 || (hayInforme && !alDia) || !hayInforme) && (
        <button type="button" className="btn" disabled={generando || !!ocupado || !puedeGenerar} onClick={() => void actualizarInforme()}>
          {generando || ocupado === "cascada" ? "Actualizando…" : hayInforme ? "Actualizar informe con todos los cambios" : "Generar informe"}
        </button>
      )}
      {error && <p role="alert" className="aviso aviso-error">{error}</p>}
      {copiado && <p role="status" className="aviso aviso-ok">{copiado}</p>}
      {respaldo && <ImagenParaCopiar imagen={respaldo} />}
      {ocupado && <p role="status" className="aviso aviso-ok">Actualizando el informe, el anexo y el PDF con tus cambios… puede tardar unos segundos.</p>}
      {[...porRecinto.entries()].map(([recinto, listaOriginal]) => {
        const ids = actualDe(recinto);
        // Primero las del informe, en el orden que se verá (1, 2, 3…); después las que no van.
        const delInforme = ids.map((id) => listaOriginal.find((f) => f.id === id)).filter((f): f is ArchivoMeta => !!f);
        const lista = [...delInforme, ...listaOriginal.filter((f) => !ids.includes(f.id))];
        const pie = pies[recinto] ?? "";
        const pieGuardado = leyendasGrupos[recinto] ?? "";
        const conBorrador = hayBorrador(recinto);
        const mostrarAcciones = conBorrador || tocados.includes(recinto) || (hayInforme && !alDia);
        const ocupadoGrupo = ocupado === `grupo:${recinto}`;
        return (
          // Cada estancia es un grupo plegable, cerrado al comienzo; el resumen dice cuántas fotos van y ofrece actualizar o regenerar.
          <details key={recinto} className="rounded-lg border border-[color:var(--borde)] bg-[color:var(--panel)]">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-2 text-sm font-semibold text-[color:var(--texto)]">
              <span>{recinto}</span>
              <span className="texto-suave font-normal">({listaOriginal.length} fotos)</span>
              <span className={`marca ${delInforme.length > 0 ? "marca-usr" : "marca-sin"} !ml-0`}>{delInforme.length} en el informe</span>
              {listaOriginal.some((f) => f.edicion && !esEdicionNula(f.edicion)) && <span className="marca marca-sin !ml-0">{listaOriginal.filter((f) => f.edicion && !esEdicionNula(f.edicion)).length} editadas</span>}
              {pieGuardado && <span className="marca marca-sin !ml-0">con leyenda de grupo</span>}
              {conBorrador && <span className="marca marca-error !ml-0">Cambios sin aplicar</span>}
              {mostrarAcciones && (
                <button type="button" className="btn ml-auto !px-3 !py-1 text-xs" disabled={generando || !!ocupado || !puedeGenerar} onClick={(ev) => { ev.preventDefault(); void actualizarInforme(); }} title="Guarda todos los cambios de fotos y leyendas y rehace el informe, el anexo, el PDF y el ZIP">
                  {generando || ocupado === "cascada" ? "Actualizando…" : "Actualizar informe"}
                </button>
              )}
            </summary>
            {mostrarAcciones && (
              <p className="px-2 pb-1 text-xs text-[color:var(--texto)]" role="status">
                {conBorrador ? "Hay cambios de orden o selección sin aplicar en esta estancia: «Actualizar informe» los guarda y rehace todo; si sales sin actualizar, se descartan." : "El informe no se ha regenerado con los últimos cambios: usa «Actualizar informe» para entregar la versión final."}
              </p>
            )}
            <div className="space-y-1 p-2">
              <label className="etiqueta" htmlFor={`pie-${recinto}`}>Leyenda al pie del grupo «{recinto}» (opcional, se guarda sola)</label>
              <div className="flex flex-wrap gap-2">
                <input id={`pie-${recinto}`} className="campo min-w-64 flex-1 px-2 py-1 text-sm" maxLength={300} placeholder="Descripción breve de las fotos de este grupo" value={pie} onChange={(e) => setPies((p) => ({ ...p, [recinto]: e.target.value }))} onBlur={() => pie.trim() !== pieGuardado && void guardarPie(recinto, pie)} />
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-3 p-2 sm:grid-cols-3 lg:grid-cols-4">
              {lista.map((f) => {
                const indice = ids.indexOf(f.id) + 1;
                const incluida = indice > 0;
                const quitada = f.edicion?.excluir === true;
                const editada = !!f.edicion && !esEdicionNula(f.edicion);
                return (
                  <li
                    key={f.id}
                    draggable={!ocupadoGrupo}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", f.id);
                      setArrastre({ id: f.id, recinto });
                    }}
                    onDragEnd={() => {
                      setArrastre(null);
                      setSobre(null);
                    }}
                    onDragOver={(e) => {
                      if (arrastre && arrastre.recinto === recinto) {
                        e.preventDefault();
                        setSobre(f.id);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      soltar(recinto, f.id);
                    }}
                    title="Arrastra para cambiar la posición de la foto dentro de la estancia"
                    className={`cursor-grab overflow-hidden rounded-lg bg-[color:var(--panel-2)] ${incluida ? "border-2 border-[color:var(--ok)]" : "border border-[color:var(--borde)]"} ${arrastre?.id === f.id ? "opacity-40" : ""} ${sobre === f.id && arrastre?.id !== f.id ? "outline outline-2 outline-offset-2 outline-[color:var(--acento)]" : ""}`}
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/casos/${casoId}/archivos/${f.id}?miniatura=1&v=${versionDe(f.edicion)}`} alt={`${recinto}: ${f.nombre}`} loading="lazy" draggable={false} className="block w-full bg-black object-cover" style={{ aspectRatio: `${FOTO_ANCHO_CM} / ${FOTO_ALTO_CM}`, opacity: incluida ? 1 : 0.55 }} />
                      {incluida && (
                        <span className="absolute left-2 top-2 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold" style={{ background: "var(--acento)", color: "var(--acento-texto)" }} title={`Posición ${indice} de ${ids.length} en el informe, de izquierda a derecha`}>{indice}</span>
                      )}
                      {incluida && (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--ok)", color: "var(--ok-fondo)" }}>
                          <Icono nombre="check" tam={14} /> En el informe
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 p-2">
                      <p className="truncate text-xs text-[color:var(--texto)]" title={f.nombre}>{f.nombre}</p>
                      <div className="flex flex-wrap gap-1 text-[11px]">
                        {editada && <span className="marca marca-sin !ml-0">Editada</span>}
                        {quitada && <span className="marca marca-error !ml-0">Quitada del informe</span>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {incluida && <BotonIcono icono="flechaIzq" etiqueta={`Mover ${f.nombre} una posición a la izquierda`} deshabilitado={indice === 1 || ocupadoGrupo} onClick={() => mover(recinto, f.id, -1)} />}
                        {incluida && <BotonIcono icono="flechaDer" etiqueta={`Mover ${f.nombre} una posición a la derecha`} deshabilitado={indice === ids.length || ocupadoGrupo} onClick={() => mover(recinto, f.id, 1)} />}
                        <BotonIcono icono="check" etiqueta={incluida ? `Quitar ${f.nombre} del informe (se aplica con Actualizar)` : `Poner ${f.nombre} en el informe (se aplica con Actualizar)`} activo={incluida} deshabilitado={ocupadoGrupo} onClick={() => alternar(recinto, f.id)} />
                        <BotonIcono icono="lapiz" etiqueta={`Editar ${f.nombre}`} onClick={() => setEditando(f)} />
                        {f.edicion && <BotonIcono icono="reiniciar" etiqueta={`Descartar la edición de ${f.nombre}`} deshabilitado={ocupado === f.id} onClick={() => void descartarEdicion(f)} />}
                        <span className="ml-auto">
                          <BotonIcono icono="copiar" etiqueta={`Copiar ${f.nombre} (${FOTO_TAMANO_TEXTO})`} onClick={() => void copiarFoto(f)} />
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
      {editando && <EditorFoto key={editando.id} casoId={casoId} foto={editando} enInforme={va.has(editando.id)} onCerrar={() => setEditando(null)} onGuardado={() => { marcarTocado(editando.recinto ?? "Sin recinto"); setEditando(null); router.refresh(); }} />}
    </div>
  );
}
