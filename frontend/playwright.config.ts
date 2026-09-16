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
      dependencies: ["setup"],
    },
  ],
});
