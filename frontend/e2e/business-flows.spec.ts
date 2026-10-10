import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * El primer flujo de un negocio, de punta a punta: alta de un proveedor, un
 * gasto asignado a él y que Inicio lo muestre. Se verifica en pantalla y por
 * la API, y lo creado se limpia en `finally` (el proveedor se archiva: no se
 * borra nunca, por eso el nombre lleva la hora).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function tokenOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const w = window as unknown as { __e2e: { ready: Promise<void>; auth: { authStateReady: () => Promise<void>; currentUser: { getIdToken: () => Promise<string> } } } };
    await w.__e2e.ready;
    await w.__e2e.auth.authStateReady();
    return w.__e2e.auth.currentUser.getIdToken();
  });
}

function api(req: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: async (path: string) => (await req.get(`${API_URL}${path}`, { headers })).json(),
    patch: (path: string, data: unknown) => req.patch(`${API_URL}${path}`, { headers, data }),
    del: (path: string) => req.delete(`${API_URL}${path}`, { headers }),
  };
}

const form = (page: Page) => page.locator("form").filter({ has: page.getByLabel("Descripción") });
// El combo que sigue a un rótulo: los campos del formulario no tienen
// aria-label propio, y por posición se rompen apenas cambia el orden.
const comboAfter = (page: Page, label: string | RegExp) =>
  form(page).getByText(label, { exact: typeof label === "string" }).locator("..").getByRole("combobox");

async function pickOption(page: Page, combobox: ReturnType<Page["getByRole"]>, name: string | RegExp) {
  await combobox.click();
  await page.getByRole("option", { name }).first().click();
}

test("proveedor → gasto asignado → Inicio lo muestra", async ({ page, request }) => {
  const stamp = Date.now();
  const name = `E2E Distribuidora ${stamp}`;
  const desc = `E2E-negocio-${stamp}`;
  await page.goto("/proveedores");
  const a = api(request, await tokenOf(page));
  let payeeId: number | undefined;
  try {
    // 1. Alta desde la pantalla, con su categoría habitual.
    await page.getByRole("button", { name: "Nuevo proveedor o empleado" }).click();
    await expect(page.getByRole("heading", { name: "Nuevo proveedor o empleado" })).toBeVisible();
    await page.getByPlaceholder("Distribuidora Norte").fill(name);
    await pickOption(page, page.getByRole("combobox").first(), "Mercadería");
    await page.getByRole("button", { name: "Crear", exact: true }).click();
    await expect(page.getByTestId("payee-row").filter({ hasText: name })).toBeVisible();
    const payees: { id: number; name: string; default_category_id: number | null }[] = await a.get("/payees");
    payeeId = payees.find(p => p.name === name)?.id;
    expect(payeeId).toBeDefined();

    // 2. Un gasto a su nombre: elegirlo propone su categoría.
    await page.goto("/expenses");
    await page.getByRole("button", { name: "Registrar egreso" }).click();
    await pickOption(page, comboAfter(page, /^Proveedor o empleado/), name);
    await expect(comboAfter(page, "Categoría")).toContainText("Mercadería");
    await page.getByLabel("Monto").fill("18.000");
    await page.getByLabel("Descripción").fill(desc);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("heading", { name: "Nuevo egreso" })).toHaveCount(0);

    // 3. La fila lo muestra y quedó guardado con su payee.
    const row = page.getByRole("button").filter({ hasText: desc });
    await expect(row).toContainText(name);
    const entries: { payee_id: number | null; amount: string }[] = await a.get(`/expenses/entries?q=${desc}`);
    expect(entries).toHaveLength(1);
    expect(entries[0].payee_id).toBe(payeeId);
    // La búsqueda también lo encuentra por el nombre del proveedor.
    const byPayee: { description: string }[] = await a.get(`/expenses/entries?q=${encodeURIComponent(name)}`);
    expect(byPayee.some(e => e.description === desc)).toBe(true);

    // 4. Inicio: a quién se le pagó.
    await page.goto("/dashboard");
    await expect(page.getByText(/Proveedores y empleados —/)).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
  } finally {
    const entries: { id: number; description?: string }[] = await a.get(`/expenses/entries?q=${desc}`);
    for (const e of entries.filter(x => x.description === desc)) await a.del(`/expenses/entries/${e.id}`);
    if (payeeId) await a.patch(`/payees/${payeeId}`, { is_active: false });
  }
});
