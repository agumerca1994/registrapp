import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * En un hogar con varias personas, cada dato dice quién lo cargó.
 *
 * Usa un hogar propio de dos personas: el de los demás specs tiene una sola, y
 * sumarle otra le cambiaría los baselines visuales. Lo que crea lo borra en
 * `finally`. Va en el proyecto `flows` porque crea datos.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const PASSWORD = "e2e-test-password-123";
const TOURS = ["dashboard-intro", "income-intro", "expenses-intro", "cards-intro"];

type E2EAuth = {
  __e2e: {
    ready: Promise<void>;
    auth: unknown;
    createUserWithEmailAndPassword: (a: unknown, e: string, p: string) => Promise<{ user: { getIdToken: () => Promise<string> } }>;
    signInWithEmailAndPassword: (a: unknown, e: string, p: string) => Promise<{ user: { getIdToken: () => Promise<string> } }>;
  };
};

async function signIn(browser: Browser, email: string, register: Record<string, unknown>, join?: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/login");
  const token = await page.evaluate(async ({ email, password }) => {
    const { __e2e: e } = window as unknown as E2EAuth;
    await e.ready;
    const cred = await e.createUserWithEmailAndPassword(e.auth, email, password)
      .catch(() => e.signInWithEmailAndPassword(e.auth, email, password));
    return cred.user.getIdToken();
  }, { email, password: PASSWORD });

  const headers = { Authorization: `Bearer ${token}` };
  const call = async (method: "get" | "post" | "delete", path: string, data?: unknown) => {
    const res = await page.request[method](`${API_URL}${path}`, { headers, data });
    return { status: res.status(), body: res.status() === 204 ? null : await res.json() };
  };
  // En una corrida repetida la persona ya existe y da 400: está bien.
  const me = await call("get", "/auth/me");
  if (me.status !== 200) {
    await call("post", join ? "/auth/join" : "/auth/register", join ? { tenant_code: join, ...register } : register);
  }
  await call("post", "/auth/me/skip-whatsapp-gate");
  await page.evaluate(ids => ids.forEach(id => localStorage.setItem(`tour_seen_${id}`, "1")), TOURS);
  return { context, page, call };
}

test("cada fila dice quién la cargó, y se puede filtrar por persona", async ({ browser }) => {
  const ana = await signIn(browser, "e2e-casa-ana@registrapp.local", { tenant_name: "E2E Casa de dos", first_name: "Ana", last_name: "Paz" });
  const code = (await ana.call("get", "/auth/me")).body.tenant_code;
  const beto = await signIn(browser, "e2e-casa-beto@registrapp.local", { first_name: "Beto", last_name: "Ruiz" }, code);

  const today = new Date().toISOString().slice(0, 10);
  const cats = (await ana.call("get", "/expenses/categories")).body;
  const cat = cats[0] ?? (await ana.call("post", "/expenses/categories", { name: "Varios", color: "#8b5cf6" })).body;
  const expense = (who: typeof ana, description: string) =>
    who.call("post", "/expenses/entries", { amount: 1000, expense_date: today, category_id: cat.id, description });

  const mine = (await expense(ana, "E2E gasto de Ana")).body;
  const theirs = (await expense(beto, "E2E gasto ajeno")).body;
  const card = (await beto.call("post", "/credit-cards", { bank: "BBVA", alias: "E2E Visa de dos" })).body;
  const now = new Date();
  const item = (await beto.call("post", `/credit-cards/${card.id}/items`, {
    year: now.getFullYear(), month: now.getMonth() + 1, description: "E2E nafta ajena",
    category_id: cat.id, item_date: today, item_type: "single", amount: 500,
  })).body;

  try {
    expect(theirs.user_id).not.toBe(mine.user_id);
    expect(item.user_id).toBe(theirs.user_id);

    const page: Page = ana.page;
    await page.goto("/expenses");
    const mineRow = page.getByRole("button", { name: /E2E gasto de Ana/ });
    const theirsRow = page.getByRole("button", { name: /E2E gasto ajeno/ });
    await expect(mineRow).toContainText("Vos");
    await expect(theirsRow).toContainText("Beto");

    // El detalle lo dice con todas las letras.
    await theirsRow.click();
    await expect(page.getByText("Lo cargó", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar" }).click();

    // Filtrar por persona saca la lista del mes, como cualquier filtro.
    await page.getByRole("button", { name: "Personalizado" }).click();
    await page.getByRole("combobox").filter({ hasText: "Lo cargó" }).click();
    await page.getByRole("option", { name: "Beto" }).click();
    await expect(theirsRow).toBeVisible();
    await expect(mineRow).toHaveCount(0);
    await page.getByRole("button", { name: /Limpiar/ }).click();
    await page.getByRole("button", { name: "Personalizado" }).click();

    // El nombre que se ve en la fila se puede buscar.
    await page.getByRole("button", { name: /Buscar/ }).click();
    await page.getByPlaceholder(/Buscar por/).fill("beto");
    await expect(theirsRow).toBeVisible();
    await expect(mineRow).toHaveCount(0);

    // En el resumen de la tarjeta también.
    await page.goto(`/tarjetas/${card.id}/${item.statement_id}`);
    const itemRow = page.getByRole("button", { name: /E2E nafta ajena/ }).first();
    await expect(itemRow).toContainText("Beto");
  } finally {
    await beto.call("delete", `/credit-cards/${card.id}?keep_expenses=false`);
    await ana.call("delete", `/expenses/entries/${mine.id}`);
    await beto.call("delete", `/expenses/entries/${theirs.id}`);
    await ana.context.close();
    await beto.context.close();
  }
});

test("en un hogar de una sola persona no aparece nada", async ({ page }) => {
  // La cuenta de siempre de los E2E: tiene una sola persona.
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Personalizado" }).click();
  await expect(page.getByRole("combobox").filter({ hasText: "Lo cargó" })).toHaveCount(0);
  await expect(page.getByText("Vos", { exact: true })).toHaveCount(0);
});
