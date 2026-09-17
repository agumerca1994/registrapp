import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * El formulario unificado de egresos, en sus cuatro combinaciones.
 *
 * Cada caso se verifica dos veces: en pantalla (lo que la persona ve) y por la
 * API (lo que realmente quedó guardado — cuotas en resúmenes, moneda, montos de
 * la división). Lo primero sin lo segundo es cómo pasa un formulario que
 * "funciona" y guarda mal.
 *
 * Los datos se siembran por la API con el token del emulador y **se borran en
 * `finally`**, pase lo que pase. Los participantes son invitados sin cuenta,
 * para no disparar avisos. Corre en su propio proyecto, antes que los visuales,
 * para que ninguna captura saque datos de un flujo a medias.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

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
    del: (path: string) => req.delete(`${API_URL}${path}`, { headers }),
  };
}

type Api = ReturnType<typeof api>;

async function ensureCategory(a: Api): Promise<string> {
  const cats: { id: number; name: string }[] = await a.get("/expenses/categories");
  if (!cats.some(c => c.name === "Varios")) await a.post("/expenses/categories", { name: "Varios" });
  return "Varios";
}

/** Borra todo lo que el test pudo haber creado con esta descripción. */
async function cleanup(a: Api, desc: string, cardId?: number) {
  const shared: { id: number; title: string }[] = await a.get("/shared-expenses");
  for (const s of shared.filter(x => x.title === desc)) await a.del(`/shared-expenses/${s.id}`);
  if (cardId) await a.del(`/credit-cards/${cardId}?keep_expenses=false`);
  const entries: { id: number; description?: string }[] = await a.get(`/expenses/entries?q=${encodeURIComponent(desc)}`);
  for (const e of entries.filter(x => x.description?.startsWith(desc))) await a.del(`/expenses/entries/${e.id}`);
}

async function openForm(page: Page) {
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Registrar egreso" }).click();
  await expect(page.getByRole("heading", { name: "Nuevo egreso" })).toBeVisible();
}

const form = (page: Page) => page.locator("form").filter({ has: page.getByLabel("Descripción") });

async function pickOption(page: Page, combobox: ReturnType<Page["getByRole"]>, name: string | RegExp) {
  await combobox.click();
  // `.first()`: con los casos corriendo en paralelo, dos pueden crear "Varios"
  // a la vez la primera vez que corre la suite en un hogar nuevo.
  await page.getByRole("option", { name }).first().click();
}

async function addGuest(page: Page, name: string) {
  await page.getByRole("button", { name: "Agregar persona" }).click();
  await page.getByPlaceholder("Nombre, alias, mail o teléfono").fill(name);
  await page.getByRole("button", { name: new RegExp(`Agregar "${name}" sin cuenta`) }).click();
}

const toggle = (page: Page, group: string, option: string) =>
  page.getByRole("group", { name: group }).getByRole("button", { name: option, exact: true }).click();

test("egreso simple", async ({ page, request }) => {
  const desc = `E2E-simple-${Date.now()}`;
  await page.goto("/expenses");
  const a = api(request, await tokenOf(page));
  const category = await ensureCategory(a);
  try {
    await openForm(page);
    await pickOption(page, form(page).getByRole("combobox").first(), category);
    await page.getByLabel("Monto").fill("1.234,50");
    await page.getByLabel("Descripción").fill(desc);
    await page.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByRole("heading", { name: "Nuevo egreso" })).toHaveCount(0);
    await expect(page.getByText(desc)).toBeVisible();
    const entries = await a.get(`/expenses/entries?q=${desc}`);
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].amount)).toBe(1234.5);
    expect(entries[0].payment_method).toBeNull();
  } finally {
    await cleanup(a, desc);
  }
});

test("con tarjeta en cuotas", async ({ page, request }) => {
  const stamp = Date.now();
  const desc = `E2E-cuotas-${stamp}`;
  await page.goto("/expenses");
  const a = api(request, await tokenOf(page));
  const category = await ensureCategory(a);
  const card = await a.post("/credit-cards", { bank: "E2E Banco", alias: `E2E ${stamp}`, due_day: 10 });
  try {
    await openForm(page);
    await pickOption(page, form(page).getByRole("combobox").first(), category);
    await page.getByLabel("Descripción").fill(desc);
    await toggle(page, "Pago", "Tarjeta");
    await pickOption(page, form(page).getByRole("combobox").nth(1), new RegExp(`E2E ${stamp}`));

    // El mes del resumen arranca en el de la fecha del gasto (hoy).
    const now = new Date();
    await expect(form(page).getByRole("button", { name: new RegExp(`^${MONTHS[now.getMonth()]} ${now.getFullYear()}$`) })).toBeVisible();

    await toggle(page, "Forma de pago con tarjeta", "En cuotas");
    await expect(page.getByLabel("Monto por cuota")).toBeVisible();
    await page.getByLabel("Monto por cuota").fill("1.000");
    await page.getByLabel("Cantidad de cuotas").fill("3");
    await expect(page.getByText(/Total de la compra: 3 ×/)).toBeVisible();
    await page.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByText(/Cargado en el resumen de/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver resumen" })).toBeVisible();

    const statements: { year: number; month: number; items: { description: string; installment_number: number | null; purchase_total: string | null }[] }[] =
      await a.get(`/credit-cards/${card.id}/statements`);
    const withItem = statements.filter(s => s.items.some(i => i.description === desc));
    expect(withItem).toHaveLength(3);
    const root = withItem.flatMap(s => s.items).find(i => i.description === desc && i.installment_number === 1);
    expect(Number(root?.purchase_total)).toBe(3000);
  } finally {
    await cleanup(a, desc, card.id);
  }
});

test("compartido en dólares", async ({ page, request }) => {
  const desc = `E2E-usd-${Date.now()}`;
  await page.goto("/expenses");
  const a = api(request, await tokenOf(page));
  try {
    await openForm(page);
    await toggle(page, "Moneda", "U$D");
    await page.getByLabel("Monto").fill("100");
    await page.getByLabel("Descripción").fill(desc);
    await toggle(page, "¿Lo compartís?", "Sí");
    await addGuest(page, "Invitado E2E 1");
    await addGuest(page, "Invitado E2E 2");
    // 100 entre 3: el centavo que sobra va a la última fila.
    await expect(form(page).getByText("U$D 33,34")).toBeVisible();
    await page.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByText(/Gasto compartido con 2 personas/)).toBeVisible();
    const shared: { title: string; currency: string; splits: { amount: string }[] }[] = await a.get("/shared-expenses");
    const mine = shared.find(s => s.title === desc);
    expect(mine?.currency).toBe("USD");
    expect(mine?.splits.map(s => Number(s.amount)).sort()).toEqual([33.33, 33.33, 33.34]);
    await expect(page.getByText("U$D 33,33").first()).toBeVisible();
  } finally {
    await cleanup(a, desc);
  }
});

test("con tarjeta y compartido", async ({ page, request }) => {
  const stamp = Date.now();
  const desc = `E2E-tarjeta-compartida-${stamp}`;
  await page.goto("/expenses");
  const a = api(request, await tokenOf(page));
  const category = await ensureCategory(a);
  const card = await a.post("/credit-cards", { bank: "E2E Banco", alias: `E2E ${stamp}`, due_day: 10 });
  try {
    await openForm(page);
    await pickOption(page, form(page).getByRole("combobox").first(), category);
    // "15.000" con punto de miles: es justo lo que el formulario de /shared lee como 15.
    await page.getByLabel("Monto").fill("15.000");
    await page.getByLabel("Descripción").fill(desc);
    await toggle(page, "Pago", "Tarjeta");
    await pickOption(page, form(page).getByRole("combobox").nth(1), new RegExp(`E2E ${stamp}`));
    await toggle(page, "¿Lo compartís?", "Sí");
    await addGuest(page, "Invitado E2E 1");
    await page.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByText(/Cargado en el resumen de .* y compartido\./)).toBeVisible();
    const shared: { title: string; credit_card_item_id: number | null; splits: { amount: string }[] }[] = await a.get("/shared-expenses");
    const mine = shared.find(s => s.title === desc);
    expect(mine?.credit_card_item_id).toBeTruthy();
    expect(mine?.splits.map(s => Number(s.amount))).toEqual([7500, 7500]);
    await expect(page.getByText("$ 7.500,00").first()).toBeVisible();
  } finally {
    await cleanup(a, desc, card.id);
  }
});

test("con tarjeta pero sin tarjetas cargadas", async ({ page }) => {
  await page.route("**/credit-cards", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await openForm(page);
  await toggle(page, "Pago", "Tarjeta");
  await expect(page.getByText("Todavía no cargaste ninguna tarjeta.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cargar una tarjeta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
});

test("editar un egreso usa el mismo formulario, sin las preguntas de alta", async ({ page, request }) => {
  const desc = `E2E-editar-${Date.now()}`;
  await page.goto("/expenses");
  const a = api(request, await tokenOf(page));
  await ensureCategory(a);
  const cats: { id: number; name: string }[] = await a.get("/expenses/categories");
  const today = new Date().toISOString().slice(0, 10);
  const created = await a.post("/expenses/entries", {
    amount: 500, description: desc, expense_date: today, currency: "ARS",
    category_id: cats.find(c => c.name === "Varios")!.id, notes: "nota que no tiene campo",
  });
  try {
    await page.goto("/expenses");
    await page.getByText(desc).click();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Editar egreso" })).toBeVisible();
    // Convertir un egreso guardado en uno de tarjeta o compartido no está soportado.
    await expect(page.getByRole("group", { name: "Pago" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "¿Lo compartís?" })).toHaveCount(0);

    await expect(page.getByLabel("Monto")).toHaveValue("500,00");
    await page.getByLabel("Monto").fill("750,25");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("heading", { name: "Editar egreso" })).toHaveCount(0);

    const [entry] = (await a.get(`/expenses/entries?q=${desc}`)).filter((e: { id: number }) => e.id === created.id);
    expect(Number(entry.amount)).toBe(750.25);
    // Las notas no tienen campo en el formulario: editar no las puede borrar.
    expect(entry.notes).toBe("nota que no tiene campo");
  } finally {
    await cleanup(a, desc);
  }
});
