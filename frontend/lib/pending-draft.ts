/**
 * El archivo que llega por la hoja de compartir, en tránsito.
 *
 * Cuando Android comparte algo con la PWA, el sistema hace un POST y quien lo
 * recibe es el **service worker**, no la página. El SW no puede llamar a la
 * API —no tiene el ID token de Firebase, que vive en el contexto de la
 * página—, así que deja lo compartido en IndexedDB, redirige a `/registrar`, y
 * la página lo levanta y lo sube con la sesión de siempre.
 *
 * **El esquema está escrito dos veces**, acá y adentro de
 * `public/firebase-messaging-sw.js`, porque el SW es un archivo estático fuera
 * del build de Next y no puede importar de `lib/`. Es el mismo patrón gemelo
 * que el repo ya acepta con `person_key` / `personKey()`: la defensa es
 * mantenerlo tonto —una base, un store, una clave fija— y que cada lado tenga
 * un comentario apuntando al otro. Si cambia el nombre de algo, cambia en los
 * dos.
 */
export const DB_NAME = "registrapp";
export const DB_VERSION = 1;
export const STORE = "shared";
export const KEY = "pending";

export interface SharedPayload {
  files: { name: string; type: string; blob: Blob }[];
  text?: string;
  title?: string;
  url?: string;
  ts: number;
}

// Diez minutos. Un payload guardado y nunca consumido está viejo para cuando la
// persona vuelve, y resucitarlo la haría cargar un gasto que ya no está
// mirando.
const MAX_AGE_MS = 10 * 60 * 1000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Devuelve lo compartido **y lo borra**.
 *
 * Destructivo a propósito: si un refresh volviera a leerlo, la persona
 * cargaría el mismo gasto dos veces sin entender de dónde salió el segundo.
 */
export async function takeSharedPayload(): Promise<SharedPayload | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await open();
    const payload = await new Promise<SharedPayload | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.get(KEY);
      get.onsuccess = () => {
        store.delete(KEY);
        resolve((get.result as SharedPayload) ?? null);
      };
      get.onerror = () => reject(get.error);
    });
    db.close();
    if (!payload || typeof payload.ts !== "number") return null;
    if (Date.now() - payload.ts > MAX_AGE_MS) return null;
    return payload;
  } catch {
    // IndexedDB puede fallar (modo privado, cuota). Perder lo compartido es
    // malo; romper la pantalla de alta por eso es peor.
    return null;
  }
}
