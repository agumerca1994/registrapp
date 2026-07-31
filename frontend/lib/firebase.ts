import { initializeApp, getApps } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
} from "firebase/auth";

const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

// Playwright/E2E only — the Auth Emulator never validates these against a
// real Google project, so no real Firebase credentials are needed to run
// tests. "demo-" is the emulator suite's convention for a project id that's
// guaranteed to never resolve to a real, billable Firebase project.
const firebaseConfig = useEmulator
  ? {
      apiKey: "demo-api-key",
      authDomain: "demo-registrapp.firebaseapp.com",
      projectId: "demo-registrapp",
      storageBucket: "demo-registrapp.appspot.com",
      messagingSenderId: "000000000000",
      appId: "1:000000000000:web:0000000000000000000000",
    }
  : {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
    };

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Never set NEXT_PUBLIC_USE_FIREBASE_EMULATOR in a real deploy environment.
if (useEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

  // Playwright's auth.setup.ts drives sign-in through this hook. Firebase's
  // default persistence is IndexedDB, which storageState() can't capture —
  // switching to localStorage here is what lets the saved session survive
  // into the fresh browser contexts each smoke test opens.
  if (typeof window !== "undefined") {
    (window as unknown as { __e2e: unknown }).__e2e = {
      auth,
      ready: setPersistence(auth, browserLocalPersistence),
      createUserWithEmailAndPassword,
      signInWithEmailAndPassword,
    };
  }
}
