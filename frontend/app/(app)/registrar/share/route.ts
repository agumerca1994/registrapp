import { NextRequest, NextResponse } from "next/server";

/**
 * Red de contención de la hoja de compartir.
 *
 * En condiciones normales este código **no corre nunca**: el service worker
 * intercepta el POST antes de que salga del dispositivo, guarda lo compartido
 * en IndexedDB y redirige. Esto existe para el caso en que el SW no esté
 * registrado —recién instalada la PWA, el registro falló, el usuario limpió el
 * almacenamiento— donde si no, el POST llegaría acá y el navegador mostraría un
 * 405 en la cara de alguien que acaba de compartir un comprobante.
 *
 * Rescata lo que se puede rescatar por una redirección: el texto. Un archivo no
 * sobrevive a un redirect y no hay dónde dejarlo (la app no tiene storage de
 * objetos y esto corre sin la sesión de Firebase), así que en ese caso abre el
 * formulario vacío con un aviso. Peor que el camino bueno, mucho mejor que un
 * error del navegador.
 */
export const dynamic = "force-dynamic";

const MAX_TEXT = 4000;

export async function POST(request: NextRequest) {
  const params = new URLSearchParams({ source: "share_target" });
  let hadFile = false;

  try {
    const form = await request.formData();
    hadFile = form.getAll("receipt").some(v => typeof v === "object");
    const text = ["title", "text", "url"]
      .map(k => form.get(k))
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join("\n")
      .slice(0, MAX_TEXT);
    if (text) params.set("text", text);
  } catch {
    // Un cuerpo ilegible no cambia qué hay que hacer: abrir el formulario.
  }

  if (hadFile && !params.has("text")) params.set("shared", "lost");
  // 303: convierte el POST en un GET, que es lo que la pantalla espera.
  return NextResponse.redirect(new URL(`/registrar?${params}`, request.url), 303);
}

/** Alguien que llega por GET a esta ruta quiso ir al formulario. */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/registrar", request.url), 307);
}
