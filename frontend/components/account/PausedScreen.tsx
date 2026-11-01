"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ToodAvatar } from "@/components/brand/ToodAvatar";
import { ToodLogo } from "@/components/brand/ToodLogo";
import { BRAND_FIELD } from "@/lib/brand/tood-cara";

// Lo que ve quien tiene la cuenta en pausa (backend: services/account_closure.py). El layout la muestra en lugar
// de la app, así no se pide nada que el backend respondería con 423. La t duerme hasta que se reactiva.
export function PausedScreen() {
  const { refreshUser, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reactivate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/me/unpause");
      await refreshUser();
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col text-white"
      style={{ background: BRAND_FIELD, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <main className="flex-1 w-full max-w-sm mx-auto px-6 py-10 flex flex-col items-center justify-center text-center">
        {/* Centrados por lo que se dibuja, como en el login. */}
        <div style={{ transform: "translateX(-3%)" }}><ToodLogo className="h-9 w-auto text-white" title="tood" /></div>
        <ToodAvatar size={150} className="mt-6 translate-x-[5.5%]" ink="#ffffff" holeColor={BRAND_FIELD} asleep />
        <h1 className="mt-6 font-display text-2xl font-semibold">Tu cuenta está en pausa</h1>
        <p className="mt-2 text-[15px] text-white/85 leading-relaxed">
          Tus datos están como los dejaste. Reactivala para volver a cargar, recibir avisos y usar el bot.
        </p>
        {error && <p className="mt-4 text-sm text-white">{error}</p>}
        <Button variant="outline" onClick={reactivate} disabled={busy}
          className="mt-10 w-full h-14 text-base font-semibold">
          {busy ? "Reactivando…" : "Reactivar mi cuenta"}
        </Button>
        <button onClick={() => logout()} className="mt-4 text-sm text-white/80 hover:text-white underline-offset-4 hover:underline">
          Cerrar sesión
        </button>
      </main>
    </div>
  );
}
