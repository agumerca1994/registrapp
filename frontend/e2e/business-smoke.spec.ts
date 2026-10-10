import { test, expect } from "@playwright/test";

// Las pantallas de un NEGOCIO, con la cuenta "E2E Rotisería" de auth.setup.ts.
// Mismo criterio que smoke.spec.ts: cada ruta pinta el layout en vez de rebotar
// o caer en un error. Las rutas de un negocio son otras que las del hogar (ver
// lib/account.ts), por eso tienen su propia lista.
const ROUTES = ["/dashboard", "/expenses", "/proveedores", "/tarjetas", "/calendario", "/settings"];

for (const route of ROUTES) {
  test(`negocio: ${route} renders the authenticated layout`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.locator("nav").first()).toBeVisible();
    await expect(page.getByText(/algo salió mal|application error/i)).toHaveCount(0);
  });
}

test("negocio: Inicio y navegación son los del negocio", async ({ page }) => {
  await page.goto("/dashboard");
  const sidebar = page.locator("aside nav");
  await expect(sidebar.getByRole("link", { name: "Proveedores y empleados" })).toBeVisible();
  for (const householdOnly of ["Ingresos", "Divisas", "Gastos compartidos", "Hipoteca", "Variables macro"]) {
    await expect(sidebar.getByRole("link", { name: householdOnly })).toHaveCount(0);
  }
  await expect(page.getByText(/^Gastos de /)).toBeVisible();
});

test("negocio: las pantallas del hogar llevan a Inicio", async ({ page }) => {
  for (const route of ["/income", "/divisas", "/shared", "/mortgage", "/macro"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/dashboard$/);
  }
});

test("negocio: el formulario de gastos no ofrece compartir", async ({ page }) => {
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Registrar egreso" }).click();
  await expect(page.getByRole("heading", { name: "Nuevo egreso" })).toBeVisible();
  await expect(page.getByText("Proveedor o empleado")).toBeVisible();
  await expect(page.getByText("¿Lo compartís?")).toHaveCount(0);
});

test.describe("hogar", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("un hogar no tiene Proveedores: lleva a Inicio", async ({ page }) => {
    await page.goto("/proveedores");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
