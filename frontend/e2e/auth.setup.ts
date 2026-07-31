import { test as setup } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/user.json";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TEST_EMAIL = "e2e@registrapp.local";
const TEST_PASSWORD = "e2e-test-password-123";

type E2EWindow = Window & {
  __e2e: {
    auth: import("firebase/auth").Auth;
    ready: Promise<void>;
    createUserWithEmailAndPassword: typeof import("firebase/auth").createUserWithEmailAndPassword;
    signInWithEmailAndPassword: typeof import("firebase/auth").signInWithEmailAndPassword;
  };
};

setup("authenticate", async ({ page }) => {
  await page.goto("/login");

  // Sign in (or register, on first run) against the Auth Emulator, entirely
  // client-side so the session lands in this browser context's localStorage —
  // that's what storageState() below actually captures (must wait for `ready`
  // first: it's what switches persistence away from Firebase's IndexedDB
  // default, which storageState() can't see).
  const idToken = await page.evaluate(
    async ({ email, password }) => {
      const w = window as unknown as E2EWindow;
      await w.__e2e.ready;
      let cred;
      try {
        cred = await w.__e2e.createUserWithEmailAndPassword(w.__e2e.auth, email, password);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "auth/email-already-in-use") {
          cred = await w.__e2e.signInWithEmailAndPassword(w.__e2e.auth, email, password);
        } else {
          throw err;
        }
      }
      return cred.user.getIdToken();
    },
    { email: TEST_EMAIL, password: TEST_PASSWORD }
  );

  const authHeader = { Authorization: `Bearer ${idToken}` };

  // Idempotent tenant setup: on a fresh emulator run this creates the tenant,
  // on a re-run it 400s ("Ya sos parte de un hogar activo") because the user
  // (and tenant) already exist — both are fine, only a real failure isn't.
  const registerRes = await page.request.post(`${API_URL}/auth/register`, {
    headers: authHeader,
    data: { tenant_name: "E2E Test Household" },
  });
  if (!registerRes.ok() && registerRes.status() !== 400) {
    throw new Error(`/auth/register failed: ${registerRes.status()} ${await registerRes.text()}`);
  }

  const gateRes = await page.request.post(`${API_URL}/auth/me/skip-whatsapp-gate`, {
    headers: authHeader,
  });
  if (!gateRes.ok()) {
    throw new Error(
      `/auth/me/skip-whatsapp-gate failed: ${gateRes.status()} ${await gateRes.text()}`
    );
  }

  // Full navigation so AuthContext re-mounts and re-fetches /auth/me now that
  // the tenant exists and the WhatsApp gate is cleared (the two direct API
  // calls above bypassed React state, so the app doesn't know about them yet).
  await page.goto("/dashboard");
  await page.waitForURL("**/dashboard");

  // Pre-dismiss the product tours (dashboard/income/expenses) so every test
  // that reuses this storageState sees the steady-state UI, not a first-visit
  // Joyride overlay — this file is the one place new tourIds need adding.
  await page.evaluate(() => {
    for (const tourId of ["dashboard-intro", "income-intro", "expenses-intro"]) {
      localStorage.setItem(`tour_seen_${tourId}`, "1");
    }
  });

  await page.context().storageState({ path: AUTH_FILE });
});
