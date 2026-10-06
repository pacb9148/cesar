import type { NextConfig } from "next";

const seguridad = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Paquetes nativos o con binarios: se cargan desde node_modules, no se empaquetan.
  serverExternalPackages: ["sharp", "pg", "playwright-core", "@sparticuz/chromium", "pizzip", "exceljs", "@electric-sql/pglite", "mammoth", "unpdf"],
  // Plantillas y baremo se leen del disco en tiempo de ejecución: deben viajar en el build.
  // browsers.json lo lee playwright-core de forma dinámica al cargarse, así que el trazado no lo
  // ve; sin él, toda ruta que importe el navegador devuelve 500 en la imagen Docker.
  outputFileTracingIncludes: {
    "/api/**": ["./plantillas/**/*", "./lib/baremo/*.json", "./node_modules/playwright-core/browsers.json"],
  },
  async headers() {
    return [{ source: "/:path*", headers: seguridad }];
  },
};

export default nextConfig;
