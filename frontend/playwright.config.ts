import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

// Requires, in separate terminals before running `npm run test:e2e`:
//   1. `npm run emulator` (this repo, /frontend) — Firebase Auth Emulator on :9099
//   2. `docker compose up` (repo root) — Postgres + backend on :8000
// The Next.js dev server itself is started automatically below.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    env: {
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
      // Mismo valor que ve el proceso de tests, para que los que dependen del
      // flag salteen o corran de acuerdo a lo que el server realmente muestra.
      NEXT_PUBLIC_FEATURE_IOS_SHORTCUT: process.env.NEXT_PUBLIC_FEATURE_IOS_SHORTCUT ?? "false",
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      testIgnore: [/visual\.spec\.ts/, /new-expense\.spec\.ts/],
      dependencies: ["setup"],
    },
    // Los flujos que crean datos corren aparte y antes que los visuales. Con
    // todo en un mismo proyecto y `fullyParallel`, una captura podía salir con
    // la tarjeta o el gasto de un flujo a medias en pantalla.
    {
      name: "flows",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      testMatch: /new-expense\.spec\.ts/,
      dependencies: ["setup"],
    },
    // Los visuales van últimos. Dependen de los otros dos a propósito: si un
    // flujo falla, sacar capturas encima de datos a medio borrar no dice nada.
    {
      name: "visual",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      testMatch: /visual\.spec\.ts/,
      dependencies: ["chromium", "flows"],
      // Las capturas de referencia se guardaron cuando este spec corría en el
      // proyecto "chromium", y el nombre del proyecto es parte del archivo
      // (`dashboard-chromium-darwin.png`). Sin fijarlo, al pasar a su propio
      // proyecto todas quedarían "faltantes".
      snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-chromium{-snapshotSuffix}{ext}",
    },
  ],
});
