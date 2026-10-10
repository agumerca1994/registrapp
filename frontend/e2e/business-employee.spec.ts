import { test, expect, type Page } from "@playwright/test";

// Un EMPLEADO del negocio (auth.setup.ts lo suma con el código del dueño):
// carga ventas y stock, y no ve los números del negocio. La pantalla esconde;
// el backend es el que de verdad niega (core/access.py).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function tokenOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const w = window as unknown as { __e2e: { ready: Promise<void>; auth: { authStateReady: () => Promise<void>; currentUser: { getIdToken: () => Promise<string> } } } };
    await w.__e2e.ready;
    await w.__e2e.auth.authStateReady();
    return w.__e2e.auth.currentUser.getIdToken();
  });
}

test("empleado: entra a Ventas y sólo ve Ventas, Productos y Configuración", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/ventas$/);
  const sidebar = page.locator("aside nav");
  for (const name of ["Ventas", "Productos", "Configuración"]) {
    await expect(sidebar.getByRole("link", { name })).toBeVisible();
  }
  for (const name of ["Inicio", "Egresos", "Proveedores y empleados", "Tarjetas"]) {
    await expect(sidebar.getByRole("link", { name })).toHaveCount(0);
  }
  for (const route of ["/expenses", "/proveedores", "/tarjetas", "/dashboard"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/ventas$/);
  }
});

test("empleado: Configuración sin código, miembros ni conector", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();
  await expect(page.getByText("Tu negocio", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Conectar con una IA")).toHaveCount(0);
  await expect(page.getByText("Rol: Empleado")).toBeVisible();
});

test("empleado: el backend le niega los números y le deja vender", async ({ page, request }) => {
  await page.goto("/ventas");
  const headers = { Authorization: `Bearer ${await tokenOf(page)}` };
  const status = async (path: string) => (await request.get(`${API_URL}${path}`, { headers })).status();
  expect(await status("/business/summary/2026/10")).toBe(403);
  expect(await status("/payees")).toBe(403);
  expect(await status("/expenses/entries")).toBe(403);
  expect(await status("/auth/members")).toBe(403);
  expect(await status("/products")).toBe(200);
  expect(await status("/stock")).toBe(200);
  const me = await (await request.get(`${API_URL}/auth/me`, { headers })).json();
  expect(me.role).toBe("employee");
  expect(me.tenant_code).toBeNull();
});
