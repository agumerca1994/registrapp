import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * El primer flujo de un negocio, de punta a punta: alta de un proveedor, un
 * gasto asignado a él y que Inicio lo muestre. Se verifica en pantalla y por
 * la API, y lo creado se limpia en `finally` (el proveedor se archiva: no se
 * borra nunca, por eso el nombre lleva la hora).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// En serie: los flujos comparten la misma cuenta de negocio y el mismo día, y
// el de ventas cierra la caja con lo que hay. En paralelo, una venta del flujo
// de stock aparecía en el cierre del otro.
test.describe.configure({ mode: "serial" });

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
    post: async (path: string, data: unknown) => (await req.post(`${API_URL}${path}`, { headers, data })).json(),
    patch: (path: string, data: unknown) => req.patch(`${API_URL}${path}`, { headers, data }),
    del: (path: string) => req.delete(`${API_URL}${path}`, { headers }),
  };
}

/** El día de negocio, igual que lib/sales.ts: Argentina, con corte a las 5. */
function businessToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() - 5 * 3600 * 1000));
}

type Api = ReturnType<typeof api>;

/** Deja el día sin ventas ni cierre: la cuenta de negocio es sólo de los E2E. */
async function clearDay(a: Api, day: string) {
  const summary: { tickets: { id: number }[]; close: unknown } = await a.get(`/sales/day/${day}`);
  for (const t of summary.tickets) await a.del(`/sales/${t.id}`);
  if (summary.close) await a.del(`/sales/close/${day}`);
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


test("producto → venta → dos ventas a la vez → cierre → Inicio", async ({ page, request }) => {
  const stamp = Date.now();
  const day = businessToday();
  await page.goto("/ventas");
  const a = api(request, await tokenOf(page));
  await clearDay(a, day);
  const product = await a.post("/products", { name: `E2E Empanada ${stamp}`, sale_price: 1500 });
  try {
    // 1. Una venta desde la pantalla: tocar el producto dos veces y cobrar.
    await page.reload();
    await page.getByRole("button", { name: "Nueva venta" }).click();
    const chip = page.getByRole("button", { name: new RegExp(`E2E Empanada ${stamp}`) });
    await chip.click();
    await chip.click();
    await expect(page.getByLabel("Cantidad")).toHaveText("2");
    await page.getByRole("button", { name: /^Cobrar/ }).click();
    await expect(page.getByRole("heading", { name: "Nueva venta" })).toHaveCount(0);
    await expect(page.getByTestId("sale-row").filter({ hasText: `2 × E2E Empanada ${stamp}` })).toBeVisible();

    // 2. Dos ventas a la vez contra Postgres: el ingreso del día no se pisa.
    await Promise.all([
      a.post("/sales", { sale_date: day, payments: [{ method: "efectivo", amount: 1000 }], client_ref: `e2e-a-${stamp}` }),
      a.post("/sales", { sale_date: day, payments: [{ method: "mercadopago", amount: 2500 }], client_ref: `e2e-b-${stamp}` }),
    ]);
    const income: { amount: string; source: { name: string } }[] =
      await a.get(`/income/entries?date_from=${day}&date_to=${day}`);
    const ventas = income.filter(e => e.source.name === "Ventas");
    expect(ventas).toHaveLength(1);
    expect(Number(ventas[0].amount)).toBe(3000 + 1000 + 2500);

    // 3. El cierre: se precarga con lo vendido y el día pasa a sumar lo contado.
    await page.reload();
    await page.getByRole("button", { name: "Cerrar el día" }).click();
    await expect(page.getByLabel("Contado en Efectivo")).toHaveValue("4.000");
    await page.getByLabel("Contado en Efectivo").fill("4.500");
    await expect(page.getByText(/sin ticket/)).toBeVisible();
    await page.getByRole("button", { name: "Cerrar el día" }).last().click();
    await expect(page.getByText("Cerrado", { exact: true })).toBeVisible();
    const summary: { total: string } = await a.get(`/sales/day/${day}`);
    expect(Number(summary.total)).toBe(4500 + 2500);

    // 4. Inicio: el resultado del mes y las ventas por medio de pago.
    await page.goto("/dashboard");
    await expect(page.getByText(/^Resultado de /)).toBeVisible();
    await expect(page.getByText(/Ventas por medio de pago —/)).toBeVisible();
  } finally {
    await clearDay(a, day);
    await a.patch(`/products/${product.id}`, { is_active: false });
  }
});

test("stock: producción → una venta resta → conteo → una compra suma", async ({ page, request }) => {
  const stamp = Date.now();
  const day = businessToday();
  await page.goto("/productos");
  const a = api(request, await tokenOf(page));
  const product = await a.post("/products", { name: `E2E Milanesa ${stamp}`, sale_price: 5000, track_stock: true });
  const level = async () => {
    const levels: { product_id: number; on_hand: string }[] = await a.get("/stock");
    return Number(levels.find(l => l.product_id === product.id)?.on_hand ?? 0);
  };
  const row = () => page.getByTestId("product-row").filter({ hasText: `E2E Milanesa ${stamp}` });
  let saleId: number | undefined;
  try {
    // 1. Producción desde el menú del producto.
    await page.reload();
    await page.getByRole("button", { name: `Acciones de E2E Milanesa ${stamp}` }).click();
    await page.getByRole("menuitem", { name: "Producción" }).click();
    await page.getByLabel("Cuántas hiciste").fill("30");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(row()).toContainText("Hay 30");

    // 2. Una venta resta (sin frenarse aunque no alcance).
    const sale = await a.post("/sales", {
      sale_date: day, lines: [{ product_id: product.id, qty: 4, unit_price: 5000 }],
      payments: [{ method: "efectivo", amount: 20000 }],
    });
    saleId = sale.id;
    expect(await level()).toBe(26);

    // 3. Un conteo deja lo que hay de verdad.
    await page.reload();
    await page.getByRole("button", { name: `Acciones de E2E Milanesa ${stamp}` }).click();
    await page.getByRole("menuitem", { name: "Contar lo que queda" }).click();
    await page.getByLabel("Cuántas quedan").fill("25");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(row()).toContainText("Hay 25");

    // 4. Una compra con "entra al stock" suma.
    await page.goto("/expenses");
    await page.getByRole("button", { name: "Registrar egreso" }).click();
    const form = page.locator("form").filter({ has: page.getByLabel("Descripción") });
    await form.getByText("Categoría", { exact: true }).locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "Mercadería" }).first().click();
    await page.getByLabel("Monto").fill("60.000");
    await page.getByLabel("Descripción").fill(`E2E-compra-${stamp}`);
    await page.getByRole("group", { name: "¿Entra al stock?" }).getByRole("button", { name: "Sí", exact: true }).click();
    await page.getByTestId("stock-line").getByRole("combobox").click();
    await page.getByRole("option", { name: `E2E Milanesa ${stamp}` }).click();
    await page.getByLabel("Cantidad que entra").fill("12");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("heading", { name: "Nuevo egreso" })).toHaveCount(0);
    expect(await level()).toBe(37);
  } finally {
    const entries: { id: number; description?: string }[] = await a.get(`/expenses/entries?q=E2E-compra-${stamp}`);
    for (const e of entries) await a.del(`/expenses/entries/${e.id}`);
    if (saleId) await a.del(`/sales/${saleId}`);
    const moves: { id: number; sale_id: number | null; expense_entry_id: number | null }[] =
      await a.get(`/stock/movements?product_id=${product.id}`);
    for (const m of moves.filter(x => !x.sale_id && !x.expense_entry_id)) await a.del(`/stock/movements/${m.id}`);
    await a.patch(`/products/${product.id}`, { is_active: false });
  }
});
