"use client";

import { getApps, initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import api from "@/lib/api";

/**
 * Notificaciones push (Firebase Cloud Messaging).
 *
 * Lo que hace distinto a esto de "pedir permiso y listo" es que en iOS hay una
 * condición previa que ningún permiso arregla: **Safari sólo entrega push si la
 * app está instalada en la pantalla de inicio**. En una pestaña normal no
 * existe `PushManager`, el permiso no se puede ni pedir, y un botón que igual
 * lo intente no hace nada y no explica por qué.
 *
 * Por eso `pushState()` no devuelve un booleano sino el motivo concreto: la
 * pantalla de Configuración muestra un texto distinto para cada caso, que es lo
 * único que le sirve a alguien que no está recibiendo avisos.
 */

export type PushState =
  /** Ni service workers ni Notification: navegador viejo o contexto inseguro. */
  | "unsupported"
  /** iPhone/iPad en pestaña: hay que "Agregar a inicio" antes de poder pedir nada. */
  | "ios-needs-install"
  /** Sitio servido sin HTTPS (una IP de la LAN, por ejemplo). Ningún navegador
   *  entrega push fuera de un contexto seguro, y el permiso ni se puede pedir. */
  | "insecure"
  /** Se puede pedir el permiso. */
  | "prompt"
  /** El usuario lo rechazó. El navegador no vuelve a preguntar. */
  | "denied"
  /** Permiso dado. */
  | "granted";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
const SW_PATH = "/firebase-messaging-sw.js";
const LAST_TOKEN_KEY = "registrapp:pushToken";

function firebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
}

// "¿Este dispositivo está registrado?" es una pregunta DISTINTA de "¿hay
// permiso?", y confundirlas es lo que hacía indiagnosticable que no llegaran
// los avisos: el permiso puede estar dado y el registro no haber ocurrido nunca
// (falta la VAPID key, `getToken` no devolvió nada, o el POST falló).
//
// Pero la contesta el backend, en GET /notifications/device-tokens/me, no este
// módulo: el token guardado acá es local al navegador, así que en un segundo
// navegador respondía "no registrado" con el dispositivo registrado.

/** Por qué no se pudo registrar, para poder mostrarlo en pantalla. */
export function pushConfigProblem(): string | null {
  if (!VAPID_KEY) return "Falta la clave VAPID en la configuración de la app.";
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return "Falta la configuración de Firebase.";
  return null;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // `navigator.standalone` es la de Safari en iOS; la media query es el
  // estándar que usan los demás.
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return iosStandalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  // El iPad moderno se declara Mac; lo delata el touch.
  return /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1);
}

/** `true` si la página se sirve por HTTPS o desde localhost. */
export function isSecure(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext;
}

export function pushState(): PushState {
  if (typeof window === "undefined") return "unsupported";

  // Antes que nada: sin contexto seguro no hay push posible, y el navegador
  // reporta el permiso como "denied" aunque el usuario nunca haya rechazado
  // nada. Decirle "lo rechazaste una vez" sería mentirle y mandarlo a buscar un
  // permiso que no va a encontrar.
  if (!isSecure()) return "insecure";

  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    // En iOS sin instalar, esto es exactamente lo que pasa: la API no existe.
    // Distinguirlo importa porque tiene arreglo y el otro caso no.
    if (isIOS() && !isStandalone()) return "ios-needs-install";
    return "unsupported";
  }
  if (!("PushManager" in window)) {
    if (isIOS() && !isStandalone()) return "ios-needs-install";
    return "unsupported";
  }
  if (isIOS() && !isStandalone()) return "ios-needs-install";

  const perm = Notification.permission;
  if (perm === "granted") return "granted";
  if (perm === "denied") return "denied";
  return "prompt";
}

async function messagingOrNull() {
  if (!(await isSupported().catch(() => false))) return null;
  const cfg = firebaseConfig();
  if (!cfg.projectId || !VAPID_KEY) return null;
  const app = getApps().find(a => a.name === "push") ?? initializeApp(cfg, "push");
  return getMessaging(app);
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const cfg = firebaseConfig();
  // La config va por query string porque el SW es un archivo estático y no ve
  // process.env. El scope se fija en "/" para que el aviso pueda abrir
  // cualquier ruta de la app.
  const qs = new URLSearchParams(cfg as Record<string, string>).toString();
  return navigator.serviceWorker.register(`${SW_PATH}?${qs}`, { scope: "/" });
}

/**
 * Pide el permiso y registra el dispositivo.
 *
 * Tiene que llamarse desde un gesto del usuario (un click): iOS ignora
 * `Notification.requestPermission()` si no viene de una interacción.
 *
 * Devuelve el estado en el que quedó, para que la UI diga qué pasó.
 */
export async function enablePush(): Promise<PushState> {
  const state = pushState();
  if (state !== "prompt" && state !== "granted") return state;

  const permission = state === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "prompt";

  try {
    const messaging = await messagingOrNull();
    if (!messaging) {
      // Permiso sí, pero la app no puede pedir token: falta la VAPID key o la
      // config de Firebase. Devolver "granted" a secas hacía que la pantalla
      // dijera "Activadas" cuando no se registró nada.
      console.warn("push: permiso concedido pero FCM no está configurado", pushConfigProblem());
      return "granted";
    }

    const registration = await registerServiceWorker();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      ...(registration ? { serviceWorkerRegistration: registration } : {}),
    });
    if (!token) {
      console.warn("push: getToken no devolvió token; el dispositivo no queda registrado");
      return "granted";
    }

    await api.post("/notifications/device-tokens", {
      token,
      platform: isIOS() ? (isStandalone() ? "ios-pwa" : "ios") : navigator.platform || "web",
    });
    localStorage.setItem(LAST_TOKEN_KEY, token);
  } catch (err) {
    // El permiso ya está dado; lo que falló es el registro. No se pierde nada
    // reintentando en el próximo arranque.
    console.warn("push: no se pudo registrar el dispositivo", err);
  }
  return "granted";
}

/**
 * Re-registra en cada arranque si el permiso ya está dado.
 *
 * No es redundante con `enablePush`: FCM rota el token cuando quiere y deja de
 * entregar al viejo sin avisar. Sin esto, los avisos dejan de llegar en algún
 * momento y no hay nada en la app que lo delate.
 */
export async function syncPushToken(): Promise<void> {
  if (pushState() !== "granted") return;
  await enablePush();
}

/** Baja del dispositivo. La llama el logout: el que venga después a este
 *  navegador no tiene por qué recibir los avisos del anterior. */
export async function disablePush(): Promise<void> {
  const token = typeof window !== "undefined" ? localStorage.getItem(LAST_TOKEN_KEY) : null;
  if (!token) return;
  try {
    await api.delete("/notifications/device-tokens", { data: { token } });
  } catch {
    // Si no se pudo dar de baja, el backend lo va a limpiar solo cuando FCM
    // le diga que el token ya no existe.
  }
  localStorage.removeItem(LAST_TOKEN_KEY);
}

/** Avisos con la app en primer plano. El SW no los ve — ahí no hay
 *  notificación del sistema — así que el callback decide qué hacer. */
export async function onForegroundPush(cb: (title: string, body: string) => void): Promise<() => void> {
  const messaging = await messagingOrNull();
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    cb(payload.notification?.title ?? "RegistrApp", payload.notification?.body ?? "");
  });
}
