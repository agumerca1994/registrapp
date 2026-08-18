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
