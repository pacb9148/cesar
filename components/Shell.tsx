"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icono, type NombreIcono } from "./Iconos";

/** Una entrada del menú lateral que dispara una acción o cambia de paso; la pantalla central la registra con su manejador. */
export type ItemMenu = { id: string; etiqueta: string; icono: NombreIcono; onClick: () => void; deshabilitado?: boolean; activo?: boolean; primaria?: boolean };

type Visible = Omit<ItemMenu, "onClick">;
type Vista = { titulo: string; pasos: Visible[]; acciones: Visible[] };
type Contexto = { ponerPasos: (titulo: string, items: ItemMenu[]) => void; ponerAcciones: (items: ItemMenu[]) => void };

const Ctx = createContext<Contexto | null>(null);

/** Firma sin funciones: el menú solo se repinta cuando cambia lo que se ve; los manejadores se leen siempre frescos desde la referencia. */
const visibles = (items: ItemMenu[]): Visible[] => items.map((it) => ({ id: it.id, etiqueta: it.etiqueta, icono: it.icono, deshabilitado: it.deshabilitado, activo: it.activo, primaria: it.primaria }));

/** Pasos del caso (Documentos, Datos, Ajuste, Informe) en el menú lateral. */
export function usePasosMenu(titulo: string, items: ItemMenu[]) {
  const ctx = useContext(Ctx);
  useEffect(() => ctx?.ponerPasos(titulo, items));
  useEffect(() => () => ctx?.ponerPasos("", []), [ctx]);
}

/** Acciones de la pantalla actual en el menú lateral; se retiran solas al salir de ella. */
export function useAccionesMenu(items: ItemMenu[]) {
  const ctx = useContext(Ctx);
  useEffect(() => ctx?.ponerAcciones(items));
  useEffect(() => () => ctx?.ponerAcciones([]), [ctx]);
}

const CLAVE = "cesar.menu.colapsado";
const EVENTO = "cesar:menu";
const suscribir = (cb: () => void) => {
  window.addEventListener(EVENTO, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENTO, cb);
    window.removeEventListener("storage", cb);
  };
};
/** «1» colapsado, «0» expandido; sin preferencia guardada, colapsado en pantallas estrechas. */
const leerColapsado = (): string => {
  try {
    return localStorage.getItem(CLAVE) ?? (window.innerWidth < 900 ? "1" : "0");
  } catch {
    return "0";
  }
};

/** Estructura de toda la aplicación: menú lateral colapsable a la izquierda y el área de trabajo al centro. */
export default function Shell({ nombre, children }: { nombre: string; children: ReactNode }) {
  const router = useRouter();
  const ruta = usePathname();
  const guardado = useSyncExternalStore(suscribir, leerColapsado, () => null);
  const colapsado = guardado === "1";
  const [vista, setVista] = useState<Vista>({ titulo: "", pasos: [], acciones: [] });
  // Los manejadores se guardan aparte: el menú solo se repinta cuando cambia lo que se ve y siempre llama a la versión más reciente.
  const manejadores = useRef<{ pasos: Map<string, () => void>; acciones: Map<string, () => void> }>({ pasos: new Map(), acciones: new Map() });

  const alternar = () => {
    try {
      localStorage.setItem(CLAVE, colapsado ? "0" : "1");
    } catch {
      /* sin almacenamiento el menú funciona igual, solo no recuerda el estado */
    }
    window.dispatchEvent(new Event(EVENTO));
  };

  const ctx = useMemo<Contexto>(
    () => ({
      ponerPasos(titulo, items) {
        manejadores.current.pasos = new Map(items.map((it) => [it.id, it.onClick]));
        setVista((v) => (JSON.stringify([v.titulo, v.pasos]) === JSON.stringify([titulo, visibles(items)]) ? v : { ...v, titulo, pasos: visibles(items) }));
      },
      ponerAcciones(items) {
        manejadores.current.acciones = new Map(items.map((it) => [it.id, it.onClick]));
        setVista((v) => (JSON.stringify(v.acciones) === JSON.stringify(visibles(items)) ? v : { ...v, acciones: visibles(items) }));
      },
    }),
    [],
  );

  async function salir() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const { titulo, pasos, acciones } = vista;
  const boton = (it: Visible, paso: boolean) => (
    <li key={it.id}>
      <button type="button" className={`menu-item ${it.primaria ? "menu-item-primaria" : ""}`} aria-current={it.activo ? (paso ? "step" : "page") : undefined} aria-label={it.etiqueta} title={it.etiqueta} disabled={it.deshabilitado} onClick={() => manejadores.current[paso ? "pasos" : "acciones"].get(it.id)?.()}>
        <Icono nombre={it.icono} tam={20} />
        {!colapsado && <span className="min-w-0 truncate">{it.etiqueta}</span>}
      </button>
    </li>
  );
  const enlace = (href: string, etiqueta: string, icono: NombreIcono, activo: boolean) => (
    <li>
      <Link href={href} className="menu-item" aria-current={activo ? "page" : undefined} aria-label={etiqueta} title={etiqueta}>
        <Icono nombre={icono} tam={20} />
        {!colapsado && <span className="min-w-0 truncate">{etiqueta}</span>}
      </Link>
    </li>
  );
  const rotulo = (t: string) => (colapsado ? <li aria-hidden="true" className="my-2 border-t border-[color:var(--borde)]" /> : <li className="menu-titulo">{t}</li>);

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex min-h-screen">
        <aside aria-label="Menú principal" className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-[color:var(--borde)] bg-[color:var(--panel)] transition-[width] duration-150 ${colapsado ? "w-16" : "w-64"}`}>
          <div className={`flex items-center gap-2 border-b border-[color:var(--borde)] p-2 ${colapsado ? "justify-center" : "justify-between"}`}>
            {!colapsado && <Link href="/casos" className="truncate px-2 font-bold text-[color:var(--texto)]">Ajustador de Siniestros</Link>}
            <button type="button" className="btn-icono" onClick={alternar} aria-expanded={!colapsado} aria-label={colapsado ? "Expandir el menú" : "Colapsar el menú a solo iconos"} title={colapsado ? "Expandir el menú" : "Colapsar el menú a solo iconos"}>
              <Icono nombre={colapsado ? "panelDer" : "panelIzq"} />
            </button>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Secciones y acciones">
            <ul className="space-y-1">
              {rotulo("Navegación")}
              {enlace("/casos", "Casos", "casos", ruta === "/casos")}
              {enlace("/ajustes", "Ajustes de IA", "sliders", ruta === "/ajustes")}
              {pasos.length > 0 && rotulo(titulo || "Pasos")}
              {pasos.map((p) => boton(p, true))}
              {acciones.length > 0 && rotulo("Acciones")}
              {acciones.map((a) => boton(a, false))}
            </ul>
          </nav>
          <div className="space-y-1 border-t border-[color:var(--borde)] p-2">
            <div className={`flex items-center gap-2 px-2 py-1 text-sm text-[color:var(--texto)] ${colapsado ? "justify-center" : ""}`} title={nombre}>
              <Icono nombre="usuario" tam={20} />
              {!colapsado && <span className="min-w-0 truncate">{nombre}</span>}
            </div>
            <button type="button" className="menu-item" onClick={() => void salir()} aria-label="Salir" title="Salir">
              <Icono nombre="salir" tam={20} />
              {!colapsado && <span>Salir</span>}
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-6 py-6">
          <div className="mx-auto w-full max-w-[1500px]">{children}</div>
        </main>
      </div>
    </Ctx.Provider>
  );
}
