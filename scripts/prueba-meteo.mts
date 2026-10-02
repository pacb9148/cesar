import { writeFileSync } from "node:fs";
import { evidenciaMeteorologica } from "../lib/meteo/inia";

const casos: [string, string][] = [
  ["Los Organilleros 581, Temuco", "2026-07-16"],
  ["Huérfanos 1751, Concepción", "2026-07-16"],
];
for (const [dir, fecha] of casos) {
  const r = await evidenciaMeteorologica(dir, fecha);
  if (!r) {
    console.log(dir, "sin resultado");
    continue;
  }
  console.log(dir, "→", r.estacion.nombre, r.estacion.comuna, `${r.distanciaKm.toFixed(1)} km`, r.dia);
  writeFileSync(`tmp/meteo-${fecha}-${r.estacion.id}.png`, r.imagenPng);
}
