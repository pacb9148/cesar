const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (const x of b) c = TABLA_CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// Firma PNG (8 bytes) + bloque IHDR completo (4 de largo + 4 de tipo + 13 de datos + 4 de CRC): el bloque `pHYs` va justo después.
const FIN_IHDR = 33;

/**
 * Anota en un PNG su resolución física (píxeles por metro) con un bloque `pHYs`. Los canvas del navegador no la escriben: sin ella, al pegar la imagen
 * en Word o en un editor se toma a 96 ppp y el tamaño no corresponde a los centímetros que se querían.
 */
export async function conResolucion(png: Blob, pxPorMetro: number): Promise<Blob> {
  const datos = new Uint8Array(await png.arrayBuffer());
  const ppm = Math.round(pxPorMetro);
  const cuerpo = new Uint8Array(13);
  cuerpo.set([0x70, 0x48, 0x59, 0x73]); // «pHYs»
  const v = new DataView(cuerpo.buffer);
  v.setUint32(4, ppm);
  v.setUint32(8, ppm);
  cuerpo[12] = 1; // unidad: metro
  const bloque = new Uint8Array(21);
  const dv = new DataView(bloque.buffer);
  dv.setUint32(0, 9);
  bloque.set(cuerpo, 4);
  dv.setUint32(17, crc32(cuerpo));
  return new Blob([datos.slice(0, FIN_IHDR), bloque, datos.slice(FIN_IHDR)], { type: "image/png" });
}
