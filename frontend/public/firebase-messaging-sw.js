/* Service worker de Firebase Cloud Messaging.
 *
 * Es un archivo estático servido tal cual: no pasa por el build de Next, así
 * que acá NO existe process.env. La config llega por query string desde
 * lib/push.ts al registrarlo (`/firebase-messaging-sw.js?apiKey=...`), que es
 * la alternativa a hardcodear el proyecto en el repo — y este repo es público.
 *
 * Ojo: esos valores son públicos por diseño en Firebase Web (viajan en el
 * bundle igual), pero eso no los hace secretos que convenga escribir a mano en
 * dos lugares distintos que después se desincronizan.
 */

importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

const params = new URL(self.location).searchParams;
const config = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  storageBucket: params.get("storageBucket"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
};

if (config.projectId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  // Sólo corre cuando la app NO está en primer plano. Con la app abierta el
  // aviso lo maneja onMessage en lib/push.ts.
  messaging.onBackgroundMessage((payload) => {
    const n = payload.notification || {};
    const data = payload.data || {};
    self.registration.showNotification(n.title || "RegistrApp", {
      body: n.body || "",
      icon: "/icon",
      badge: "/icon",
      // Un tag fijo hace que un aviso nuevo reemplace al anterior en vez de
      // apilar diez notificaciones de lo mismo.
      tag: "registrapp",
      data: { url: data.url || "/shared" },
    });
  });
}

// Tocar el aviso tiene que llevar a la pantalla que lo explica, y reusar la
// ventana ya abierta si la hay: abrir una segunda copia de la PWA deja al
// usuario con dos y sin saber cuál es cuál.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/shared";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});


/* ──────────────────────────────────────────────────────────────────────────
 * Hoja de compartir de Android (Web Share Target)
 *
 * Cuando alguien comparte un comprobante con RegistrApp, el sistema hace un
 * POST multipart a /registrar/share y **el que lo recibe es este service
 * worker**, no la página. Acá no hay forma de llamar a la API: el ID token de
 * Firebase vive en el contexto de la página. Así que esto guarda lo compartido
 * en IndexedDB, responde con un redirect a /registrar, y la página lo levanta
 * y lo sube con la sesión de siempre.
 *
 * Tres reglas que no hay que aflojar:
 *
 * - **El handler es angosto**: sólo POST a esa ruta exacta. El scope es "/" y
 *   la app no tiene historia offline; ponerse a cachear acá es cómo se shippea
 *   un bundle viejo que después nadie puede limpiar.
 * - **Va fuera del `if (config.projectId)`** de arriba. Si esto viviera adentro,
 *   un registro sin config de Firebase dejaría la hoja de compartir muerta sin
 *   ningún síntoma.
 * - **Nunca dejar el POST sin respuesta.** Si algo falla, igual se redirige a
 *   /registrar: quedarse sin responder deja a la persona mirando un error del
 *   navegador después de compartir, que es el peor final posible para esto.
 *
 * El esquema de IndexedDB está duplicado en frontend/lib/pending-draft.ts
 * porque este archivo es estático y no puede importar de lib/. Si cambia acá,
 * cambia allá.
 * ────────────────────────────────────────────────────────────────────────── */
const SHARE_PATH = "/registrar/share";
const SHARE_DB = "registrapp";
const SHARE_DB_VERSION = 1;
const SHARE_STORE = "shared";
const SHARE_KEY = "pending";

function openShareDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, SHARE_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_STORE)) {
        req.result.createObjectStore(SHARE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putSharedPayload(payload) {
  return openShareDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SHARE_STORE, "readwrite");
        tx.objectStore(SHARE_STORE).put(payload, SHARE_KEY);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      })
  );
}

async function handleShare(request) {
  try {
    const form = await request.formData();
    const files = [];
    for (const entry of form.getAll("receipt")) {
      if (entry && typeof entry === "object" && "name" in entry) {
        files.push({ name: entry.name, type: entry.type, blob: entry });
      }
    }
    await putSharedPayload({
      files,
      text: form.get("text") || "",
      title: form.get("title") || "",
      url: form.get("url") || "",
      ts: Date.now(),
    });
  } catch (err) {
    // Se registra y se sigue: el redirect es lo que no puede faltar.
    console.warn("share target: no se pudo guardar lo compartido", err);
  }
  // URL absoluta: `Response.redirect` exige una URL válida y con una relativa
  // puede levantar excepción, que acá significa dejar el POST sin respuesta.
  const target = new URL("/registrar?source=share_target&shared=1", self.location.origin);
  return Response.redirect(target.href, 303);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== SHARE_PATH) return;
  event.respondWith(handleShare(event.request));
});
