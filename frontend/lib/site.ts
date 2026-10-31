// Árbol de dominios de la marca (ver CLAUDE.md, "Marca tood"):
//   SITE_URL  → el sitio público: la home, /hogar, /negocio, /conectar, /legal
//   APP_URL   → la app: login, onboarding, invitaciones, el consentimiento OAuth y todo (app)
// El backend vive aparte, en NEXT_PUBLIC_API_URL. Mientras estas dos no estén configuradas, todo sigue
// en el mismo host y los links quedan relativos: nada cambia hasta que exista el dominio.
// Las dos se hornean en el build (literal process.env, ARG + ENV en Dockerfile.prod y args en el compose).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

/** Link a una pantalla de la app desde el sitio público. */
export const appHref = (path: string) => (APP_URL ? `${APP_URL}${path}` : path);
/** Link a una página pública desde la app. */
export const siteHref = (path: string) => (SITE_URL ? `${SITE_URL}${path}` : path);

/** Rutas del sitio público (por prefijo). Lo demás es de la app. */
const PUBLIC_PREFIXES = ["/hogar", "/negocio", "/conectar", "/legal"];
export const isPublicPath = (path: string) =>
  path === "/" || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
