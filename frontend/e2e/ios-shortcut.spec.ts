import { test, expect, devices } from "@playwright/test";

/**
 * El camino de iOS.
 *
 * En iPhone no existe la hoja de compartir web ni los `shortcuts` del manifest,
 * así que la única vía es un Atajo que la persona arma una vez: extrae el texto
 * de la captura con el OCR del propio iOS y abre `/registrar` con ese texto en
 * la URL. Todo el parseo queda del lado del servidor, que es lo que permite
 * arreglarlo con un deploy en vez de pedirle a cada usuario que rehaga su atajo.
 */

// El texto tal como lo entrega "Extraer texto de la imagen" sobre una captura
// de Mercado Pago.
const OCR = `Transferencia enviada
$ 12.500,50
Para
Juan Pérez
CVU 0000003100010000000001
20 de agosto de 2026`;

test("el Atajo aterriza en /registrar con el gasto cargado", async ({ page }) => {
  await page.goto(`/registrar?source=shortcut&text=${encodeURIComponent(OCR)}`);
  await expect(page.getByRole("heading", { name: "Registrar gasto" })).toBeVisible();
  await expect(page.getByLabel("Monto")).toHaveValue("12.500,50");
  await expect(page.getByPlaceholder("Dónde fue")).toHaveValue("Juan Pérez");
  await expect(page.getByText("20 de agosto")).toBeVisible();
  // El CVU de 22 dígitos está en el mismo texto y es más grande que el importe.
  // Que no lo agarre es la mitad del trabajo del parser.
});

test("las instrucciones del Atajo se muestran sólo en iPhone", async ({ browser }) => {
  const iphone = await browser.newContext({
    ...devices["iPhone 14"],
    storageState: "e2e/.auth/user.json",
  });
  const onPhone = await iphone.newPage();
  await onPhone.goto("/settings");
  await expect(
    onPhone.getByRole("heading", { name: /Compartir un comprobante desde el iPhone/ })
  ).toBeVisible();
  // El camino que se ofrece primero es la descarga; los pasos manuales quedan
  // plegados detrás, así que ese texto NO tiene que estar visible de entrada.
  await expect(onPhone.getByRole("link", { name: "Descargar el atajo", exact: true })).toBeVisible();
  await expect(onPhone.getByText(/Extraer texto de la imagen/)).toHaveCount(0);
  await iphone.close();

  // En Android la app aparece sola en el menú de compartir, así que estas
  // instrucciones serían para un teléfono que esa persona no tiene.
  const desktop = await browser.newContext({ storageState: "e2e/.auth/user.json" });
  const elsewhere = await desktop.newPage();
  await elsewhere.goto("/settings");
  await expect(elsewhere.getByText(/Compartir un comprobante desde el iPhone/)).toHaveCount(0);
  await desktop.close();
});

test("el archivo del atajo se descarga firmado", async ({ browser }) => {
  const iphone = await browser.newContext({
    ...devices["iPhone 14"],
    storageState: "e2e/.auth/user.json",
  });
  const page = await iphone.newPage();
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: "Descargar el atajo", exact: true })).toBeVisible();

  await expect(page.getByRole("link", { name: /Descargar el atajo «preguntar»/ })).toBeVisible();

  // Los dos archivos se sirven de verdad.
  for (const file of ["registrar-gasto.shortcut", "registrar-gasto-preguntar.shortcut"]) {
    const r = await page.request.get(`/atajos/${file}`);
    expect(r.status(), file).toBe(200);
    expect((await r.body()).subarray(0, 4).toString(), file).toBe("AEA1");
  }

  const res = await page.request.get("/atajos/registrar-gasto.shortcut");
  expect(res.status()).toBe(200);
  // `AEA1` es Apple Encrypted Archive: el formato de un atajo **firmado**. Sin
  // firma, iOS 15+ sólo lo importa si el usuario activa "Permitir atajos no
  // fiables" en Ajustes, que es un interruptor global que no se le puede pedir
  // a nadie. Si este assert se cae, la descarga dejó de servir para algo.
  const body = await res.body();
  expect(body.subarray(0, 4).toString()).toBe("AEA1");

  // Los pasos manuales quedan como respaldo, plegados: son once y compiten con
  // el botón, que es lo que casi todo el mundo debería usar.
  await expect(page.getByText(/Abrí la app/)).toHaveCount(0);
  await page.getByRole("button", { name: /Armalo a mano/ }).click();
  await expect(page.getByText(/Abrí la app/)).toBeVisible();

  await iphone.close();
});
