import { test as setup } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/user.json";
const BUSINESS_AUTH_FILE = "e2e/.auth/business.json";
const EMPLOYEE_AUTH_FILE = "e2e/.auth/employee.json";
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

async function authenticate(page: import("@playwright/test").Page, opts: {
  email: string; tenantName?: string; kind?: "business"; joinCode?: string; file: string;
}) {
  const { email, tenantName, kind, joinCode, file } = opts;
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
    { email, password: TEST_PASSWORD }
  );

  const authHeader = { Authorization: `Bearer ${idToken}` };

  // Idempotent tenant setup: on a fresh emulator run this creates the tenant,
  // on a re-run it 400s ("Ya sos parte de un hogar activo") because the user
  // (and tenant) already exist — both are fine, only a real failure isn't.
  // Con `joinCode` se suma a un tenant que ya existe (el empleado del negocio);
  // en una corrida repetida también da 400 ("Ya sos parte…"), y está bien.
  const registerRes = joinCode
    ? await page.request.post(`${API_URL}/auth/join`, { headers: authHeader, data: { tenant_code: joinCode } })
    : await page.request.post(`${API_URL}/auth/register`, {
        headers: authHeader,
        data: { tenant_name: tenantName, ...(kind ? { kind } : {}) },
      });
  if (registerRes.status() === 403 && kind === "business") {
    throw new Error(
      "/auth/register 403: el backend de desarrollo tiene que tener BUSINESS_SIGNUP_ENABLED=true " +
      "(docker-compose.yml) para crear la cuenta de negocio de los E2E."
    );
  }
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
  // Un empleado no tiene Inicio: la app lo manda a Ventas.
  await page.goto("/dashboard");
  await page.waitForURL(joinCode ? "**/ventas" : "**/dashboard");

  // Pre-dismiss the product tours (dashboard/income/expenses) so every test
  // that reuses this storageState sees the steady-state UI, not a first-visit
  // Joyride overlay — this file is the one place new tourIds need adding.
  await page.evaluate(() => {
    for (const tourId of ["dashboard-intro", "income-intro", "expenses-intro"]) {
      localStorage.setItem(`tour_seen_${tourId}`, "1");
    }
  });

  await page.context().storageState({ path: file });
}

// En serie: con las dos cuentas en paralelo, la del negocio quedaba sin sesión
// en su storageState (sola, o como segunda, anda). Son dos logins: el costo de
// hacerlos uno detrás del otro es un segundo.
setup.describe.configure({ mode: "serial" });

setup("authenticate", async ({ page }) => {
  await authenticate(page, { email: TEST_EMAIL, tenantName: "E2E Test Household", file: AUTH_FILE });
});

// La cuenta de un NEGOCIO (tenants.kind="business"): sus pantallas, su
// navegación y sus flujos corren en los proyectos `business*`.
setup("authenticate business", async ({ page }) => {
  await authenticate(page, {
    email: "e2e-negocio@registrapp.local", tenantName: "E2E Rotisería", kind: "business",
    file: BUSINESS_AUTH_FILE,
  });
});


// Un EMPLEADO del negocio de arriba: se suma con el código del dueño, que se
// pide con un login directo contra el emulador (sin navegador).
setup("authenticate employee", async ({ page }) => {
  const signIn = await page.request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
    { data: { email: "e2e-negocio@registrapp.local", password: TEST_PASSWORD, returnSecureToken: true } },
  );
  const { idToken } = await signIn.json();
  const me = await (await page.request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${idToken}` } })).json();
  if (!me.tenant_code) throw new Error("No pude leer el código del negocio de los E2E");
  await authenticate(page, { email: "e2e-empleado@registrapp.local", joinCode: me.tenant_code, file: EMPLOYEE_AUTH_FILE });
});