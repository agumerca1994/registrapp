// El número sale de package.json, horneado en el build (next.config.ts). Cómo se sube: CLAUDE.md, "Versiones".
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
export const IS_BETA = APP_VERSION.includes("-beta");
export const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE
  ? new Date(process.env.NEXT_PUBLIC_BUILD_DATE).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
  : null;
