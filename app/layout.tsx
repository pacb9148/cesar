import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ajustador de Siniestros",
  description: "Ajuste de pérdida técnico para liquidadores de seguros",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
