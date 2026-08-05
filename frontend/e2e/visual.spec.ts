import { test, expect } from "@playwright/test";

// Visual regression baseline for the v3 redesign (hard-shadow hero cards,
// violet brand palette, pill buttons/chips). This does NOT compare against
// the pre-redesign UI — the new look is the intended baseline, established
// the first time this suite runs with `--update-snapshots`. Its job from
// here on is catching *accidental* visual regressions in future changes.
//
// /dashboard and /calendario render the current date/month, so their
// snapshots will need a refresh (`--update-snapshots`) periodically as time
// passes — that's expected drift, not a regression.
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
