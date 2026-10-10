import type { ReactNode } from "react";

/** Iconos de línea (24×24, trazo del color del texto). Los botones que los usan llevan siempre aria-label y title. */
const base = (hijos: ReactNode, tam: number) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {hijos}
  </svg>
);

const D = (d: string) => <path d={d} />;

export const ICONOS = {
  zoomMas: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" /></>,
  zoomMenos: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35M8 11h6" /></>,
  ajustar: D("M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"),
  rotarIzq: D("M3 12a9 9 0 1 0 3-6.7M3 4v5h5"),
  rotarDer: D("M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"),
  volteoH: D("M12 3v18M8 7l-5 5 5 5V7zM16 7l5 5-5 5V7z"),
  volteoV: D("M3 12h18M7 8l5-5 5 5H7zM7 16l5 5 5-5H7z"),
  cuadricula: D("M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"),
  mano: D("M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15"),
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  contraste: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor" /></>,
  gota: D("M12 2.7C9 7 5 10.5 5 14.5a7 7 0 0 0 14 0c0-4-4-7.5-7-11.8z"),
  check: D("M20 6L9 17l-5-5"),
  minimizar: D("M5 19h14"),
  maximizar: <rect x="5" y="5" width="14" height="14" rx="1" />,
  restaurar: D("M8 8V5h11v11h-3M5 8h11v11H5z"),
  cerrar: D("M18 6L6 18M6 6l12 12"),
  guardar: D("M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7"),
  reiniciar: D("M3 7v6h6M3 13a9 9 0 1 0 3-7"),
  ojo: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  diagonal: D("M3 3h18v18H3zM3 3l18 18M21 3L3 21"),
  cuadrado: <rect x="4" y="4" width="16" height="16" rx="1" />,
  etiqueta: <><path d="M20 12l-8 8-9-9V3h8z" /><circle cx="7.5" cy="7.5" r="1.2" /></>,
  texto: D("M4 6h16M12 6v14M8 20h8"),
  lapiz: D("M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"),
  opacidad: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" opacity=".5" /></>,
  grosor: D("M4 6h16M4 12h16M4 18h16"),
  columnas: D("M3 3h18v18H3zM9 3v18M15 3v18"),
  seleccion: D("M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M4 7V4"),
  negrita: D("M6 4h7a4 4 0 0 1 0 8H6zM6 12h8a4 4 0 0 1 0 8H6z"),
  cursiva: D("M19 4h-9M14 20H5M15 4L9 20"),
  subrayado: D("M6 4v7a6 6 0 0 0 12 0V4M4 21h16"),
  insertar: D("M12 5v14M5 12h14"),
  papelera: D("M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"),
  filas: D("M3 3h18v18H3zM3 9h18M3 15h18"),
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>,
  flechaIzq: D("M19 12H5M11 6l-6 6 6 6"),
  flechaDer: D("M5 12h14M13 6l6 6-6 6"),
  menu: D("M4 6h16M4 12h16M4 18h16"),
  panelIzq: D("M3 3h18v18H3zM9 3v18M15 9l-3 3 3 3"),
  panelDer: D("M3 3h18v18H3zM9 3v18M13 9l3 3-3 3"),
  casos: D("M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"),
  sliders: D("M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"),
  carpeta: D("M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"),
  subir: D("M12 16V4M7 9l5-5 5 5M4 20h16"),
  archivo: D("M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6"),
  datos: D("M4 5h16M4 12h16M4 19h10"),
  actividad: D("M3 12h4l3-8 4 16 3-8h4"),
  informe: D("M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6"),
  ejecutar: D("M6 4l14 8-14 8z"),
  salir: D("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"),
  usuario: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
} as const;

export type NombreIcono = keyof typeof ICONOS;

export function Icono({ nombre, tam = 20 }: { nombre: NombreIcono; tam?: number }) {
  return base(ICONOS[nombre], tam);
}

/** Botón solo con icono: etiqueta accesible y tooltip obligatorios. `activo` lo deja como interruptor (aria-pressed). */
export function BotonIcono({ icono, etiqueta, onClick, activo, deshabilitado, tam = 20 }: { icono: NombreIcono; etiqueta: string; onClick: () => void; activo?: boolean; deshabilitado?: boolean; tam?: number }) {
  return (
    <button type="button" className="btn-icono" aria-label={etiqueta} title={etiqueta} aria-pressed={activo === undefined ? undefined : activo} disabled={deshabilitado} onClick={onClick}>
      <Icono nombre={icono} tam={tam} />
    </button>
  );
}
