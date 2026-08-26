/**
 * Registrar el service worker. Una sola implementación, a propósito.
 *
 * El SW hace dos trabajos que no tienen nada que ver entre sí —entregar los
 * avisos de FCM y recibir lo que se comparte desde la hoja de compartir de
 * Android— pero **sólo puede haber un service worker por scope**, así que es
 * el mismo archivo y el mismo registro.
 *
 * Dos cosas que romperían algo si se tocan:
 *
 * 1. **La URL tiene que ser byte a byte la misma en cada llamada.** El
 *    navegador compara la URL registrada, query string incluido: si dos
 *    llamadas arman el mismo query en distinto orden, cada carga de la app se
 *    interpreta como un SW nuevo y se dispara un ciclo de actualización que no
 *    hacía falta. Por eso `swUrl()` es la única que la construye y `push.ts`
 *    la importa de acá en vez de tener su copia.
 *
 * 2. **Se registra siempre, no sólo con permiso de push.** Antes el registro
 *    vivía adentro de `enablePush()`, así que en un teléfono que nunca aceptó
 *    notificaciones el SW no existía — y sin SW no hay hoja de compartir. Esa
 *    dependencia era invisible: la feature simplemente no aparecía, sin ningún
 *    error, y sólo para las personas que habían dicho que no a los avisos.
 */
const SW_PATH = "/firebase-messaging-sw.js";

function firebaseConfig(): Record<string, string> {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
}

/** La URL exacta con la que se registra. No construirla en otro lado. */
export function swUrl(): string {
  // El SW es un archivo estático fuera del build de Next y no ve process.env,
  // así que la config de Firebase viaja por query string.
  const qs = new URLSearchParams(firebaseConfig()).toString();
  return `${SW_PATH}?${qs}`;
}

export function swSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/**
 * Registra el SW si hace falta y devuelve el registro.
 *
 * Es idempotente: registrar la misma URL con el mismo scope dos veces devuelve
 * el registro que ya existe, no crea otro.
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!swSupported()) return null;
  try {
    // scope "/" para que el aviso pueda abrir cualquier ruta y para que la
    // hoja de compartir pueda apuntar a /registrar/share.
    return await navigator.serviceWorker.register(swUrl(), { scope: "/" });
  } catch (err) {
    // Un SW que no registra no puede tumbar la app: sin él se pierden los
    // avisos en segundo plano y la hoja de compartir, y todo lo demás anda.
    console.warn("service worker: no se pudo registrar", err);
    return null;
  }
}
