"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { disablePush } from "@/lib/push";
import { auth, googleProvider } from "@/lib/firebase";
import api from "@/lib/api";

interface AuthContextType {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AppUser | null>;
  clearUser: () => void;
}

export interface AppUser {
  id: number;
  firebase_uid: string;
  tenant_id: number;
  tenant_code: string | null;
  tenant_name: string | null;
  // "household" | "business". Ver lib/account.ts: ahí se decide qué ve cada uno.
  tenant_kind?: "household" | "business" | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  alias: string | null;
  discoverable: boolean;
  whatsapp_notifications: boolean;
  whatsapp_phone: string | null;
  whatsapp_gate_pending: boolean;
  // En pausa (ver components/account/PausedScreen.tsx): el layout muestra esa pantalla en vez de la app.
  paused_at?: string | null;
  // "employee" sólo en un negocio: ve Ventas, Productos y su perfil (lib/account.ts).
  role: "admin" | "member" | "employee" | string;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function claimPendingInvite() {
  const token = localStorage.getItem("pendingInviteToken");
  if (!token) return;
  try {
    await api.post(`/shared-expenses/invite/${token}/claim`);
  } catch {
    // Already claimed or expired — ignore
  }
  localStorage.removeItem("pendingInviteToken");
}

// El link que el bot de WhatsApp le manda a quien todavía no tiene cuenta
// (`/login?wa=…`, ver backend services/wa_signup.py). Se guarda al llegar,
// porque entre el link y la cuenta hay un login y quizás el alta, y se canjea
// apenas existe la cuenta: vincula el número y el bot carga lo que se mandó.
// No se saca de la URL a propósito: desde el navegador interno de WhatsApp el
// login no funciona, y "Abrir en el navegador" tiene que llevarse el token.
const WA_SIGNUP_KEY = "pendingWaSignup";

function stashWaSignup() {
  try {
    const token = new URLSearchParams(window.location.search).get("wa");
    if (token) localStorage.setItem(WA_SIGNUP_KEY, token);
  } catch {
    // Sin storage no hay cómo recordarlo: el número se vincula a mano.
  }
}

/** true si vinculó el número (hay que volver a pedir el usuario). */
async function claimPendingWaSignup(): Promise<boolean> {
  let token: string | null = null;
  try { token = localStorage.getItem(WA_SIGNUP_KEY); } catch { return false; }
  if (!token) return false;
  try {
    await api.post("/auth/wa-signup/claim", { token });
    localStorage.removeItem(WA_SIGNUP_KEY);
    return true;
  } catch (err: unknown) {
    // Un link usado, vencido o de un número ajeno no se reintenta; un corte
    // de red sí, en el próximo arranque.
    if ((err as { response?: unknown })?.response) localStorage.removeItem(WA_SIGNUP_KEY);
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    stashWaSignup();
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          let { data } = await api.get("/auth/me");
          // Una cuenta que ya existía y entró por el link del bot.
          if (await claimPendingWaSignup()) ({ data } = await api.get("/auth/me"));
          setAppUser(data);
        } catch {
          setAppUser(null);
        }
      } else {
        setAppUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const loginWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const refreshUser = async (): Promise<AppUser | null> => {
    try {
      let { data } = await api.get("/auth/me");
      // After registration/join, claim any pending invite link stored in localStorage
      await claimPendingInvite();
      // Recién creada desde el link del bot: el número queda vinculado y el
      // paso obligatorio de WhatsApp del alta ya no hace falta.
      if (await claimPendingWaSignup()) ({ data } = await api.get("/auth/me"));
      setAppUser(data);
      return data;
    } catch {
      setAppUser(null);
      return null;
    }
  };

  const clearUser = () => { setAppUser(null); };

  const logout = async () => {
    // Antes del signOut, que necesita el token para llamar al backend: el que
    // use este navegador después no tiene por qué recibir los avisos del
    // anterior. Si falla, el backend igual lo va a limpiar cuando FCM le diga
    // que ese token ya no existe.
    await disablePush().catch(() => {});
    await signOut(auth);
    setAppUser(null);
  };

  return (
    <AuthContext.Provider value={{ firebaseUser, appUser, loading, loginWithGoogle, logout, refreshUser, clearUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}