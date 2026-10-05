// Detección del navegador embebido de otra app (WhatsApp, Instagram, etc.).
//
// Por qué existe: el bot de WhatsApp manda links a /conciliar, y WhatsApp los
// abre en su navegador interno — un WebView que no comparte sesión con la PWA
// instalada ni con el navegador real. Ahí el login de Google se rompe con
// "missing initial state" (Firebase guarda el estado del flujo en
// sessionStorage y el WebView lo pierde entre la ida y la vuelta), y la
// pantalla blanca que queda es de Firebase: no podemos interceptarla. La única
// jugada honesta es avisar ANTES de que se toque el botón, con la salida
// concreta ("Abrir en el navegador").
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Tokens de los in-app browsers más comunes + el marcador "wv" del WebView
  // de Android (el de WhatsApp moderno no siempre se identifica por nombre).
  if (/(WhatsApp|Instagram|FBAN|FBAV|FB_IAB|Line\/|MicroMessenger|Snapchat|TikTok)/i.test(ua)) {
    return true;
  }
  return /Android.*; wv\)/i.test(ua);
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}
