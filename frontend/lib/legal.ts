/**
 * Datos de los documentos legales (/legal). Es un BORRADOR: el titular y el
 * mail son provisorios hasta tener el dominio y la persona o empresa que
 * responde. Cambiar acá cambia las tres páginas.
 *
 * Pendiente antes de sacar la marca de borrador:
 * - titular real (nombre o razón social, CUIT, domicilio);
 * - inscripción de la base de datos en el registro de la AAIP (Ley 25.326, art. 21);
 * - "Eliminar mi cuenta" en Configuración, que la política ya describe (ver CLAUDE.md);
 * - revisión de un abogado matriculado.
 */
export const LEGAL = {
  owner: "Registrapp.com.ar",
  email: "consultas@registrapp.com.ar",
  updated: "29 de octubre de 2026",
  version: "0.1",
  draft: true,
};

export const LEGAL_DOCS = [
  { href: "/legal/privacidad", title: "Política de privacidad",
    lead: "Qué datos guardamos, para qué, con quién los compartimos y cómo ejercés tus derechos." },
  { href: "/legal/terminos-hogar", title: "Términos y condiciones de tero Hogar",
    lead: "Las reglas para usar la app con las cuentas de tu casa." },
  { href: "/legal/terminos-negocio", title: "Términos y condiciones de tero Negocio",
    lead: "Las reglas para usar la app en un comercio, con tu equipo." },
];
