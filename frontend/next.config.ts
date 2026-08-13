import type { NextConfig } from "next";

// El token de Firebase vive en el browser (IndexedDB, por diseño del SDK: no hay
// opción HttpOnly), así que un XSS en cualquier parte de la app se lleva una
// credencial con acceso completo al hogar. La CSP es el control que compensa eso
// y no había ninguna: ni CSP, ni HSTS, ni X-Frame-Options.
//
// `connect-src` necesita el dominio de la API además de Firebase. Se resuelve en
// build time igual que el resto de los NEXT_PUBLIC_*.
const API_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").origin;
  } catch {
    return "http://localhost:8000";
  }
})();

const CSP = [
  "default-src 'self'",
  // Next inyecta su bootstrap inline; sacar 'unsafe-inline' de script-src exige
  // pasar a nonces por middleware, que es un cambio aparte.
  "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    API_ORIGIN,
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "https://securetoken.googleapis.com",
    "https://identitytoolkit.googleapis.com",
  ].join(" "),
  // Firebase Auth resuelve el estado de sesión en un iframe de firebaseapp.com.
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  // La CSP arranca en Report-Only a propósito: en modo enforce, un origen que
  // falte rompe el login sin aviso. Mirá la consola del browser un par de días,
  // y cuando no reporte violaciones cambiá esta key por
  // "Content-Security-Policy" — el valor no se toca.
  { key: "Content-Security-Policy-Report-Only", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Baked in at build time so the user-menu popover can show "last updated"
  // — for this app a new build IS a new deploy (pushing to main triggers a
  // full rebuild in Easypanel), so build time is an honest proxy for it.
  env: {
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString(),
  },
  // Next's dev-only route indicator defaults to bottom-left, which collides
  // with the sidebar's user-menu avatar (also bottom-left). Dev-only, no
  // effect on production builds.
  devIndicators: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
