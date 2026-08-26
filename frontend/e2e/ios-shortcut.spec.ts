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
  await expect(onPhone.getByText(/Extraer texto de la imagen/)).toBeVisible();
  await iphone.close();

  // En Android la app aparece sola en el menú de compartir, así que estas
  // instrucciones serían para un teléfono que esa persona no tiene.
  const desktop = await browser.newContext({ storageState: "e2e/.auth/user.json" });
  const elsewhere = await desktop.newPage();
  await elsewhere.goto("/settings");
  await expect(elsewhere.getByText(/Compartir un comprobante desde el iPhone/)).toHaveCount(0);
  await desktop.close();
});
