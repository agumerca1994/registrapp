"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import api from "@/lib/api";

interface AuthContextType {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearUser: () => void;
}

interface AppUser {
  id: number;
  firebase_uid: string;
  tenant_id: number;
  tenant_code: string | null;
  email: string;
  display_name: string | null;
  whatsapp_phone: string | null;
  whatsapp_gate_pending: boolean;
  role: string;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const { data } = await api.get("/auth/me");
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

  const refreshUser = async () => {
    try {
      const { data } = await api.get("/auth/me");
      setAppUser(data);
      // After registration/join, claim any pending invite link stored in localStorage
      await claimPendingInvite();
    } catch {
      setAppUser(null);
    }
  };

  const clearUser = () => { setAppUser(null); };

  const logout = async () => {
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