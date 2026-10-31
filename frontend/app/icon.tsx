import { readFile } from "node:fs/promises";
import { join } from "node:path";

// El ícono de la app es la t de tood, blanca sobre el violeta: el PNG que genera tools/brand/build.py.
// Se sirve el archivo tal cual (en vez de dibujarlo acá) para que no haya dos versiones del ícono.
export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default async function Icon() {
  const png = await readFile(join(process.cwd(), "public/brand/tood/tood-icono-192.png"));
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
}
