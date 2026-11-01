import { NextResponse, type NextRequest } from "next/server";
import { APP_ALIASES, APP_URL, SITE_URL, isPublicPath } from "@/lib/site";

// Manda cada ruta a su subdominio: las páginas públicas al sitio y el resto a la app. Sólo actúa cuando
// NEXT_PUBLIC_SITE_URL y NEXT_PUBLIC_APP_URL están configuradas y son hosts distintos; si no, no toca nada.
const siteHost = SITE_URL ? new URL(SITE_URL).host : "";
const appHost = APP_URL ? new URL(APP_URL).host : "";
// La app puede vivir en más de un dominio (el viejo y el nuevo, mientras dure el cambio): todos son "la app".
const appHosts = [appHost, ...APP_ALIASES.map((u) => new URL(u).host)].filter(Boolean);

export function middleware(req: NextRequest) {
  if (!siteHost || !appHost || siteHost === appHost) return NextResponse.next();
  const host = req.headers.get("host") ?? "";
  const { pathname, search } = req.nextUrl;

  // www es el mismo sitio: una sola dirección, sin contenido duplicado.
  if (host === `www.${siteHost}`) return NextResponse.redirect(`${SITE_URL}${pathname}${search}`, 308);

  if (appHosts.includes(host)) {
    // La raíz de la app es el inicio, en el mismo dominio por el que entró: el login ya redirige a quien no entró.
    if (pathname === "/") return NextResponse.redirect(`https://${host}/dashboard${search}`, 308);
    if (isPublicPath(pathname)) return NextResponse.redirect(`${SITE_URL}${pathname}${search}`, 308);
  } else if (host === siteHost && !isPublicPath(pathname)) {
    return NextResponse.redirect(`${APP_URL}${pathname}${search}`, 308);
  }
  return NextResponse.next();
}

// Ni los archivos estáticos (cualquier ruta con extensión: imágenes, el manifest, los instructivos .html,
// el service worker) ni los internos de Next pasan por acá: se sirven en los dos hosts.
export const config = { matcher: ["/((?!_next/|.*\\..*).*)"] };
