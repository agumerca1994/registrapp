import { test, expect } from "@playwright/test";

// Functional smoke tests — they don't assert on styling, only that each
// authenticated route renders its layout (nav) instead of bouncing to
// /login or /onboarding or hitting an error boundary. See visual.spec.ts
// for the v3-redesign screenshot baseline.
const ROUTES = [
  "/dashboard",
  "/income",
  "/expenses",
  "/divisas",
  "/mortgage",
  "/macro",
  "/settings",
  "/shared",
  "/tarjetas",
  "/calendario",
];

for (const route of ROUTES) {
  test(`${route} renders the authenticated layout`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.locator("nav").first()).toBeVisible();
    await expect(page.getByText(/algo salió mal|application error/i)).toHaveCount(0);
  });
}
