import { test, expect } from "@playwright/test";

// /oauth/authorize lives outside the (app) route group and has no sidebar, so
// it can't join the ROUTES arrays in smoke.spec.ts / visual.spec.ts (both
// assert a visible nav). It's covered here instead — it's a public page that
// strangers reach from Claude's browser, so its failure states matter.

test("consent screen rejects an unknown transaction", async ({ page }) => {
  await page.goto("/oauth/authorize?txn=no-existe");
  await expect(page.getByText("No se puede continuar")).toBeVisible();
  await expect(page.getByText(/no existe o ya fue usada/i)).toBeVisible();
});

test("consent screen complains when the txn is missing entirely", async ({ page }) => {
  await page.goto("/oauth/authorize");
  await expect(page.getByText(/falta el identificador/i)).toBeVisible();
});
