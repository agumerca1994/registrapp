import api from "@/lib/api";

// Lo que no dice nada de la app: el navegador, la señal, o algo que ya loguea el backend.
const NOISE = /ResizeObserver loop|Network Error|^canceled$|Script error|Load failed|Failed to fetch|Request failed with status code/i;
const MAX_PER_LOAD = 5;

const sent = new Set<string>();

/**
 * Manda un error de pantalla a los logs del backend, una vez por mensaje. Sin esto
 * sólo queda en la consola de quien lo sufrió. Nunca falla: reportar un error no
 * puede dar otro. Va la ruta sin el query, donde viajan los tokens de los links.
 */
export function reportError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error ?? "").slice(0, 2000);
  if (!message || NOISE.test(message) || sent.has(message) || sent.size >= MAX_PER_LOAD) return;
  sent.add(message);
  api.post("/client-errors", {
    message,
    stack: error instanceof Error ? error.stack?.slice(0, 8000) : undefined,
    path: window.location.pathname,
    host: window.location.host,
  }).catch(() => {});
}
