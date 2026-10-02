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
  outputFileTracingIncludes: {
    "/api/**": ["./plantillas/**/*", "./lib/baremo/*.json"],
  },
  async headers() {
    return [{ source: "/:path*", headers: seguridad }];
  },
};

export default nextConfig;
