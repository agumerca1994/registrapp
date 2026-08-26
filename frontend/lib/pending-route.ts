/**
 * Recordar a dónde iba alguien cuando lo mandamos a loguearse.
 *
 * Existe por un caso concreto: la hoja de compartir de Android y el Atajo de
 * iOS aterrizan en `/registrar?amount=...` con los datos del comprobante en la
 * URL. Si esa persona no tiene sesión abierta, el guard de `(app)` la manda a
 * `/login` y la URL —con los datos adentro— se pierde. El síntoma es el peor
 * posible: compartiste un comprobante, la app abrió, y no pasó nada.
 *
 * Es el gemelo de `pendingInviteToken` en `AuthContext`, que se escribió para
 * exactamente el mismo problema con las invitaciones a gastos compartidos.
 */
const KEY = "registrapp:pendingRoute";

// Diez minutos. Retomar una ruta guardada hace media hora es adivinar: para
// entonces la persona ya está haciendo otra cosa y el salto se lee como un bug.
const MAX_AGE_MS = 10 * 60 * 1000;

/** Rutas que vale la pena retomar. */
function isWorthKeeping(path: string): boolean {
  // Sólo con querystring: sin datos no hay nada que perder, y /dashboard es
  // igual de bueno como destino.
  const [pathname, search] = path.split("?");
  if (!search) return false;
  // Lista blanca explícita. Guardar cualquier ruta convierte esto en un
  // redirector abierto alimentado por lo que haya en la barra de direcciones.
  return pathname === "/registrar";
}

export function stashPendingRoute(): void {
  if (typeof window === "undefined") return;
  try {
    const path = window.location.pathname + window.location.search;
    if (!isWorthKeeping(path)) return;
    sessionStorage.setItem(KEY, JSON.stringify({ path, ts: Date.now() }));
  } catch {
    // sessionStorage puede fallar (modo privado viejo, cuota). Perder el deep
    // link es malo; romper el login por eso es peor.
  }
}

/** Devuelve la ruta guardada y la borra. Null si no hay o si venció. */
export function takePendingRoute(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const { path, ts } = JSON.parse(raw) as { path: string; ts: number };
    if (!path || typeof ts !== "number") return null;
    if (Date.now() - ts > MAX_AGE_MS) return null;
    if (!isWorthKeeping(path)) return null;
    // No saltar si ya estamos ahí: `router.replace` a la ruta actual re-monta
    // la pantalla y le borra el estado que el usuario ya empezó a cargar.
    if (window.location.pathname + window.location.search === path) return null;
    return path;
  } catch {
    return null;
  }
}
