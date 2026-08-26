import { test, expect } from "@playwright/test";

/**
 * El camino de alta rápida, de punta a punta.
 *
 * Es el único spec de flujo del repo, y existe porque `/registrar` es el
 * destino de todos los canales de carga (hoja de compartir, Atajo de iOS, deep
 * link del bot): si esta pantalla se rompe, se rompen todos a la vez y el
 * smoke —que sólo comprueba que la ruta renderiza— no se entera.
 *
 * **No deja nada atrás**: deshace el gasto que crea y reusa una categoría
 * existente en vez de acuñar una por corrida. Un test que ensucia la base es
 * un test que se termina desactivando.
 */
test("registrar un gasto y deshacerlo", async ({ page }) => {
  // La CSP del proyecto está a propósito en Report-Only (ver next.config.ts) y
  // el navegador avisa en cada carga. No es de esta pantalla.
  const KNOWN = /upgrade-insecure-requests.*report-only/;
  const errors: string[] = [];
  page.on("console", m => { if (m.type() === "error" && !KNOWN.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));

  // Prellenado por querystring, tal como llega desde la hoja de compartir.
  // El monto va en formato argentino a propósito: `parseFloat("777,77")` da 7.
  await page.goto("/registrar?amount=12.500,50&description=Coto+Bulnes&source=share_target");
  await expect(page.getByRole("heading", { name: "Registrar gasto" })).toBeVisible();
  await expect(page.getByLabel("Monto")).toHaveValue("12.500,50");
  await expect(page.getByPlaceholder("Dónde fue")).toHaveValue("Coto Bulnes");
  await expect(page.getByText("Hoy", { exact: true })).toBeVisible();

  // Categoría: chips, con la puerta al selector completo siempre presente.
  const empty = page.getByRole("button", { name: "+ Crear la primera" });
  const chips = page.getByRole("radiogroup", { name: "Categoría" });
  await expect(empty.or(chips).first()).toBeVisible();
  if (await empty.isVisible()) {
    // Sólo en un hogar sin ninguna categoría. Se crea una vez y las corridas
    // siguientes la reusan.
    await empty.click();
    await page.getByPlaceholder("Supermercado").fill("Varios");
    await page.getByRole("button", { name: "Crear", exact: true }).click();
  }
  await expect(chips).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver todas" })).toBeVisible();
  await chips.getByRole("radio").first().click();

  await page.getByRole("button", { name: "Guardar gasto" }).click();
  await expect(page.getByRole("button", { name: "Registrar otro" })).toBeVisible();
  await expect(page.getByText("$ 12.500,50")).toBeVisible();

  // Llegó a la lista. En una pestaña aparte: navegar y volver remonta React y
  // pierde la confirmación, que es lo correcto — "Deshacer" es del momento.
  const tab = await page.context().newPage();
  await tab.goto("/expenses");
  await expect(tab.getByText("Coto Bulnes").first()).toBeVisible();
  await expect(tab.getByText("$ 12.500,50").first()).toBeVisible();

  // Deshacer lo borra de verdad, que es lo que hace seguro un flujo de un toque.
  await page.getByRole("button", { name: /Deshacer/ }).click();
  await expect(page.getByRole("button", { name: "Guardar gasto" })).toBeVisible();
  await tab.reload();
  await expect(tab.getByText("Coto Bulnes")).toHaveCount(0);
  await tab.close();

  expect(errors, `errores de consola: ${errors.join(" | ")}`).toHaveLength(0);
});
