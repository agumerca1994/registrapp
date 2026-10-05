import { test, expect } from "@playwright/test";

/**
 * Conciliación de resúmenes (/conciliar), detrás de NEXT_PUBLIC_FEATURE_RECONCILE.
 *
 * La ruta no va en los ROUTES de smoke/visual: esos arrays no saben de flags y
 * con el flag apagado la pantalla muestra a propósito el aviso de "no
 * disponible", que para smoke parecería una página rota. playwright.config.ts
 * le pasa al dev server el mismo valor que ve este proceso; ojo con
 * `reuseExistingServer`, un `npm run dev` ya corriendo conserva su entorno.
 */
const RECONCILE_ON = process.env.NEXT_PUBLIC_FEATURE_RECONCILE === "true";

test("/conciliar renderiza la pantalla de subida", async ({ page }) => {
  test.skip(!RECONCILE_ON, "flag apagado: la conciliación no está publicada");
  await page.goto("/conciliar");
  await expect(page.getByRole("heading", { name: "Conciliar" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Subir resumen \(PDF\)/ })).toBeVisible();
  await expect(page.getByText(/algo salió mal|application error/i)).toHaveCount(0);
});

test("con el flag apagado, /conciliar avisa y la navegación no la ofrece", async ({ page }) => {
  test.skip(RECONCILE_ON, "flag prendido: lo cubre el test de arriba");
  await page.goto("/conciliar");
  await expect(page.getByText("Esta función no está disponible.")).toBeVisible();
  await expect(page.locator("nav").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Conciliar", exact: true })).toHaveCount(0);
});
