/**
 * Datos de los documentos legales (/legal). Cambiar acá cambia las tres páginas.
 * Los mails de tood.com.ar son redirecciones de Cloudflare (Email Routing) a la casilla de la marca:
 * consultas@ para usuarios y datos personales, administracion@ para lo administrativo.
 *
 * Pendiente antes de sacar la marca de borrador:
 * - domicilio del titular (lo pide el registro de la AAIP);
 * - inscripción de la base de datos en el registro de la AAIP (Ley 25.326, art. 21);
 * - revisión de un abogado matriculado.
 */
export const LEGAL = {
  owner: "Miguel Agustín Mercado",
  cuit: "20-37726925-0",
  email: "consultas@tood.com.ar",
  updated: "11 de noviembre de 2026",
  version: "0.6",
  draft: true,
};

export const LEGAL_DOCS = [
  { href: "/legal/privacidad", title: "Política de privacidad",
    lead: "Qué datos guardamos, para qué, con quién los compartimos y cómo ejercés tus derechos." },
  { href: "/legal/terminos-hogar", title: "Términos y condiciones de tood Hogar",
    lead: "Las reglas para usar la app con las cuentas de tu casa." },
  { href: "/legal/terminos-negocio", title: "Términos y condiciones de tood Negocio",
    lead: "Las reglas para usar la app en un comercio, con tu equipo." },
];
