import { test, expect, devices } from "@playwright/test";

/**
 * El `+` del dashboard abre el formulario de siempre de Egresos, no una
 * pantalla de alta aparte.
 */
test("el + del dashboard abre 'Nuevo egreso'", async ({ browser }) => {
  // En viewport de iPhone: ahí es donde el + es la única puerta.
  const iphone = await browser.newContext({
    ...devices["iPhone 14"],
    storageState: "e2e/.auth/user.json",
  });
  const page = await iphone.newPage();
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Registrar gasto" }).click();

  await expect(page.getByRole("heading", { name: "Nuevo egreso" })).toBeVisible();
  // La marca se borra de la URL enseguida...
  await expect(page).toHaveURL(/\/expenses$/);

  // ...para que recargar no vuelva a abrir el formulario.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nuevo egreso" })).toHaveCount(0);
  await iphone.close();
});
