import { test, expect } from "@playwright/test";

/**
 * La hoja de compartir de Android (Web Share Target).
 *
 * Cubre las tres cosas que pueden romperse por separado, y la primera es la que
 * más importa: el service worker que recibe lo compartido es **el mismo** que
 * entrega los avisos de FCM, una feature en producción.
 */

const RECIBO = `Comprobante de transferencia
Importe: $ 45.000,00
Destinatario: MARIA LOPEZ
CBU: 0170099220000067797370
Fecha: 20/08/2026`;

/** Un POST de navegación multipart, que es lo que hace Android al compartir. */
async function share(page: import("@playwright/test").Page, opts: { text?: string; file?: { name: string; type: string; body: string } }) {
  await page.evaluate(({ text, file }) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/registrar/share";
    form.enctype = "multipart/form-data";
    if (text) {
      // textarea y no input: un <input> no puede contener saltos de línea, el
      // navegador los borra. La hoja de compartir real sí los preserva.
      const ta = document.createElement("textarea");
      ta.name = "text";
      ta.value = text;
      form.append(ta);
    }
    if (file) {
      const dt = new DataTransfer();
      dt.items.add(new File([file.body], file.name, { type: file.type }));
      const input = document.createElement("input");
      input.type = "file";
      input.name = "receipt";
      input.files = dt.files;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  }, opts);
}

test("el service worker se registra aunque no haya permiso de push", async ({ page }) => {
  await page.goto("/dashboard");
  const info = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    // `ready` resuelve en cuanto hay un worker activo, que puede estar todavía
    // en "activating" — esperar el evento evita un test intermitente.
    const sw = reg.active!;
    if (sw.state !== "activated") {
      await new Promise<void>(res => {
        sw.addEventListener("statechange", function h() {
          if (sw.state === "activated") { sw.removeEventListener("statechange", h); res(); }
        });
      });
    }
    return {
      scope: reg.scope,
      script: sw.scriptURL,
      state: sw.state,
      permission: Notification.permission,
    };
  });

  // Ésta es la regresión que se está fijando: el registro vivía adentro de
  // enablePush(), así que sin permiso de notificaciones no había SW — y por lo
  // tanto tampoco hoja de compartir, en silencio y sólo para esas personas.
  expect(info.permission).not.toBe("granted");
  expect(info.script).toContain("firebase-messaging-sw.js");
  expect(info.state).toBe("activated");
  expect(info.scope).toMatch(/\/$/);

  // Y la config de FCM sigue viajando por query string. Si se pierde, el push
  // deja de funcionar sin dar ningún error.
  expect(info.script).toContain("apiKey=");
});

/** Lo que quedó en IndexedDB para la página, o null si ya se consumió. */
async function pendingPayload(page: import("@playwright/test").Page) {
  return page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open("registrapp", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("shared")) req.result.createObjectStore("shared");
    };
    req.onsuccess = () => {
      const get = req.result.transaction("shared", "readonly").objectStore("shared").get("pending");
      get.onsuccess = () => resolve(get.result ?? null);
      get.onerror = () => resolve("error");
    };
    req.onerror = () => resolve("error");
  }));
}

/**
 * La app ya no lee comprobantes (se eliminó el lector, 2026-09). La hoja de
 * compartir sigue existiendo, así que lo que se comprueba ahora es que llegar
 * por ahí no deje a la persona a oscuras: abre el formulario, dice que hay que
 * cargarlo a mano, y no deja lo compartido colgado en IndexedDB.
 */
const AVISO = /Llegaste desde un comprobante/;

test("compartir texto abre el formulario y avisa que se carga a mano", async ({ page }) => {
  await page.goto("/registrar");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });

  await share(page, { text: RECIBO });
  await page.waitForURL(/\/registrar\?.*shared=1/);

  await expect(page.getByText(AVISO)).toBeVisible();
  await expect(page.getByLabel("Monto")).toHaveValue("");
  expect(await pendingPayload(page)).toBeNull();
});

test("compartir un archivo abre el formulario y no lo deja colgado", async ({ page }) => {
  await page.goto("/registrar");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });

  // Un archivo no entra en una URL: es el camino que el service worker cubre
  // guardándolo en IndexedDB. Aunque ya nadie lo lea, la página lo tiene que
  // consumir, o queda ocupando espacio hasta que vence.
  await share(page, { file: { name: "comprobante.pdf", type: "application/pdf", body: "%PDF-1.4" } });
  await page.waitForURL(/\/registrar\?.*shared=1/);

  await expect(page.getByText(AVISO)).toBeVisible();
  await expect(page.getByLabel("Monto")).toHaveValue("");
  expect(await pendingPayload(page)).toBeNull();
});

test("sin service worker, la ruta de contención igual abre el formulario", async ({ page }) => {
  await page.goto("/registrar");
  // Se desregistra a propósito: es el caso de la PWA recién instalada, o de un
  // registro que falló. Sin la ruta de contención, el POST daría un 405 en la
  // cara de alguien que acaba de compartir un comprobante.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  });

  await share(page, { text: RECIBO });
  await page.waitForURL(/\/registrar\?/);

  await expect(page.getByRole("heading", { name: "Registrar gasto" })).toBeVisible();
  await expect(page.getByText(AVISO)).toBeVisible();
});
