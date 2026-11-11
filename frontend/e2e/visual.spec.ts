import { test, expect } from "@playwright/test";

// Visual regression baseline for the 1.1.0 redesign ("vidrio sobre violeta":
// violet top block, cream paper, glass tab bar and sheets). The baselines
// were regenerated with `--update-snapshots` when it went to production
// (2026-11-11); their job is catching *accidental* visual changes from here on.
//
// /dashboard and /calendario render the current date/month, so their
// snapshots will need a refresh (`--update-snapshots`) periodically as time
// passes — that's expected drift, not a regression.
const ROUTES = [
  "/dashboard",
  "/income",
  "/expenses",
  "/registrar",
  "/divisas",
  "/creditos",
  "/objetivos",
  "/inversiones",
  "/macro",
  "/settings",
  "/shared",
  "/tarjetas",
  "/calendario",
];

for (const route of ROUTES) {
  test(`${route} matches its visual baseline`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("nav").first()).toBeVisible();
    await page.waitForTimeout(300); // let charts/animations settle
    await expect(page).toHaveScreenshot(`${route.replace("/", "")}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
}
