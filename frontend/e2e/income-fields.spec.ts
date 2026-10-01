import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * Campos de detalle por fuente de ingreso.
 *
 * Lo que tiene que cumplirse: el neto se calcula solo con el detalle, el
 * backend deriva bruto/deducciones de los ítems, y **quitar un campo de la
 * fuente no toca los ingresos ya cargados** — el viejo sigue mostrándolo y uno
 * nuevo ya no lo ofrece.
 *
 * Las fuentes no se pueden borrar (no hay endpoint), así que se reusa una fija
 * y se le reponen los campos por la API al empezar y al terminar; los ingresos
 * sí se borran en `finally`. Va en el proyecto `flows` porque crea datos.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SOURCE = "E2E Sueldo detallado";
const FIELDS = [
  { name: "Bruto", kind: "add" },
  { name: "Bono", kind: "add" },
  { name: "Ganancias", kind: "subtract" },
] as const;

interface Field { id: number; name: string; kind: string; is_active: boolean }
interface Source { id: number; name: string; fields: Field[] }

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
    patch: async (path: string, data: unknown) => (await req.patch(`${API_URL}${path}`, { headers, data })).json(),
    del: (path: string) => req.delete(`${API_URL}${path}`, { headers }),
  };
}

type Api = ReturnType<typeof api>;

/** La fuente fija con exactamente Bruto/Bono/Ganancias activos, reusando los
 *  ids que ya existan para no acumular campos archivados corrida tras corrida. */
async function resetSource(a: Api): Promise<Source> {
  const sources: Source[] = await a.get("/income/sources");
  const existing = sources.find(s => s.name === SOURCE);
  if (!existing) return a.post("/income/sources", { name: SOURCE, income_type: "salary", fields: FIELDS });
  const byName = new Map(existing.fields.map(f => [f.name, f.id]));
  return a.patch(`/income/sources/${existing.id}`, {
    fields: FIELDS.map(f => ({ ...f, id: byName.get(f.name) })),
  });
}

async function cleanup(a: Api, note: string) {
  const entries: { id: number; notes?: string }[] = await a.get(`/income/entries?q=${encodeURIComponent(note)}`);
  for (const e of entries.filter(x => x.notes?.startsWith(note))) await a.del(`/income/entries/${e.id}`);
}

const entryForm = (page: Page) => page.locator("form").filter({ has: page.getByLabel("Neto") });

async function openNewEntry(page: Page) {
  await page.goto("/income");
  await page.getByRole("button", { name: "Registrar ingreso" }).click();
  await expect(page.getByRole("heading", { name: "Nuevo ingreso" })).toBeVisible();
  await entryForm(page).getByRole("combobox").first().click();
  await page.getByRole("option", { name: new RegExp(SOURCE) }).click();
}

test("detalle por fuente: neto automático y quitar un campo no toca lo cargado", async ({ page, request }) => {
  // Un solo test largo y serial: el primer compile del dev server se come buena parte de los 30s.
  test.setTimeout(90_000);
  const note = `E2E-ingreso-${Date.now()}`;
  await page.goto("/income");
  const a = api(request, await tokenOf(page));
  const source = await resetSource(a);
  try {
    // 1. Cargar con detalle: el neto sale solo (sumas − restas).
    await openNewEntry(page);
    const form = entryForm(page);
    await form.getByLabel("Bruto", { exact: true }).fill("1.000.000");
    await form.getByLabel("Bono", { exact: true }).fill("200.000");
    await form.getByLabel("Ganancias", { exact: true }).fill("150.000,50");
    await expect(form.getByLabel("Neto")).toHaveValue("1049999.50");
    await form.getByLabel("Notas").fill(note);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("heading", { name: "Nuevo ingreso" })).toBeHidden();

    // Lo que quedó guardado: ítems, y bruto/deducciones derivados por el backend.
    const [saved] = (await a.get(`/income/entries?q=${note}`)) as {
      id: number; amount: string; bruto: string; deducciones: string;
      items: { name: string; amount: string }[];
    }[];
    expect(Number(saved.amount)).toBe(1049999.5);
    expect(Number(saved.bruto)).toBe(1200000);
    expect(Number(saved.deducciones)).toBe(150000.5);
    expect(saved.items.map(i => i.name).sort()).toEqual(["Bono", "Bruto", "Ganancias"]);

    // 2. Quitar "Bono" desde la configuración de la fuente.
    await page.getByTitle("Más acciones").click();
    await page.getByRole("menuitem", { name: "Fuentes" }).click();
    // El renglón de la lista de fuentes (nombre + tipo), no el del ingreso de atrás.
    await page.getByRole("button", { name: new RegExp(`^${SOURCE} Sueldo`) }).click();
    await expect(page.getByRole("heading", { name: "Editar fuente" })).toBeVisible();
    const bonoRow = page.getByTestId("source-field-row").filter({ has: page.locator('input[value="Bono"]') });
    await bonoRow.getByTitle("Quitar campo").click();
    await expect(page.getByText("Quitados", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("heading", { name: "Editar fuente" })).toBeHidden();

    const after: Source[] = await a.get("/income/sources");
    const bono = after.find(s => s.id === source.id)!.fields.find(f => f.name === "Bono")!;
    expect(bono.is_active).toBe(false);

    // 3. El ingreso viejo conserva su Bono…
    await page.goto("/income");
    await page.getByRole("button", { name: new RegExp(SOURCE) }).first().click();
    await expect(page.getByText("(quitado de la fuente)")).toBeVisible();
    await expect(page.getByText("Bono")).toBeVisible();

    // …y uno nuevo ya no lo ofrece.
    await openNewEntry(page);
    await expect(entryForm(page).getByLabel("Bruto", { exact: true })).toBeVisible();
    await expect(entryForm(page).getByLabel("Bono", { exact: true })).toHaveCount(0);
  } finally {
    await cleanup(a, note);
    await resetSource(a);
  }
});
