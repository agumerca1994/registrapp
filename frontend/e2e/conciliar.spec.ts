import { test, expect } from "@playwright/test";

/**
 * "Subir resumen" (la revisión de resúmenes de tarjeta, rutas /conciliar/*),
 * detrás de NEXT_PUBLIC_FEATURE_RECONCILE.
 *
 * Ya no hay sección propia: la entrada es el botón en /tarjetas, que lleva a
 * /tarjetas/resumenes (subida + historial), y /conciliar redirige ahí para que
 * un favorito viejo no dé 404.
 * playwright.config.ts le pasa al dev server el mismo valor que ve este
 * proceso; ojo con `reuseExistingServer`, un `npm run dev` ya corriendo
 * conserva su entorno.
 */
const RECONCILE_ON = process.env.NEXT_PUBLIC_FEATURE_RECONCILE === "true";

test("/tarjetas ofrece \"Subir resumen\" y lleva a /tarjetas/resumenes", async ({ page }) => {
  test.skip(!RECONCILE_ON, "flag apagado: subir resumen no está publicado");
  await page.goto("/tarjetas");
  const link = page.getByRole("link", { name: "Subir resumen" });
  await expect(link).toBeVisible();
  await expect(page.getByText(/algo salió mal|application error/i)).toHaveCount(0);
  await link.click();
  await expect(page).toHaveURL(/\/tarjetas\/resumenes$/);
});

test("/tarjetas/resumenes muestra el historial y la subida", async ({ page }) => {
  test.skip(!RECONCILE_ON, "flag apagado: subir resumen no está publicado");
  await page.goto("/tarjetas/resumenes");
  await expect(page.getByRole("heading", { name: "Resúmenes subidos" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subir resumen" })).toBeVisible();
  await expect(page.getByText(/algo salió mal|application error/i)).toHaveCount(0);
});

test("/conciliar redirige a /tarjetas/resumenes", async ({ page }) => {
  test.skip(!RECONCILE_ON, "flag apagado: subir resumen no está publicado");
  await page.goto("/conciliar");
  await expect(page).toHaveURL(/\/tarjetas\/resumenes$/);
});

test("con el flag apagado, /tarjetas no ofrece \"Subir resumen\"", async ({ page }) => {
  test.skip(RECONCILE_ON, "flag prendido: lo cubren los tests de arriba");
  await page.goto("/tarjetas");
  await expect(page.getByRole("heading", { name: "Tarjetas de crédito" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subir resumen" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Subir resumen" })).toHaveCount(0);
});

test("con el flag apagado, /tarjetas/resumenes no ofrece la subida", async ({ page }) => {
  test.skip(RECONCILE_ON, "flag prendido: lo cubren los tests de arriba");
  await page.goto("/tarjetas/resumenes");
  await expect(page.getByText("Esta función no está disponible.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Subir resumen" })).toHaveCount(0);
});
