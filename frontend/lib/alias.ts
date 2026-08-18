import { foldText } from "@/lib/utils";

/**
 * Sugerencia de alias a partir del nombre.
 *
 * Vive acá y no dentro de una pantalla porque la usan el alta y la edición de
 * perfil, y dos generadores distintos darían sugerencias distintas para la
 * misma persona.
 *
 * Sin acentos (el alias sólo admite `[a-z0-9._]`), espacios en puntos, y afuera
 * todo lo que el backend rechazaría — así la sugerencia nunca nace inválida.
 */
export function suggestAlias(...parts: (string | null | undefined)[]): string {
  const base = parts.filter(Boolean).join(" ").trim();
  const s = foldText(base)
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/[._]{2,}/g, ".")
    .replace(/^[^a-z]+/, "")
    .replace(/[._]+$/, "");
  return s.length >= 4 ? s.slice(0, 30) : "";
}
