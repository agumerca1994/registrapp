import { readFile } from "node:fs/promises";
import { join } from "node:path";

// El ícono de la app es la t de tood, blanca sobre el violeta: el PNG que genera tools/brand/build.py.
// Se sirve el archivo tal cual (en vez de dibujarlo acá) para que no haya dos versiones del ícono.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const png = await readFile(join(process.cwd(), "public/brand/tood/tood-icono-180.png"));
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
}
