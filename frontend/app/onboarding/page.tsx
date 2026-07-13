"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import WhatsAppVerifyForm from "@/components/WhatsAppVerifyForm";
import { MessageCircle } from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const { firebaseUser, appUser, loading: authLoading, refreshUser } = useAuth();
  const [step, setStep] = useState<"form" | "whatsapp">("form");

  useEffect(() => {
    if (authLoading) return;
    if (!firebaseUser) { router.replace("/login"); return; }
    if (appUser && !appUser.whatsapp_gate_pending) { router.replace("/dashboard"); return; }
    if (appUser && appUser.whatsapp_gate_pending) setStep("whatsapp");
  }, [firebaseUser, appUser, authLoading, router]);

  const [mode, setMode] = useState<"create" | "join">("create");
  const [tenantName, setTenantName] = useState("");
  const [tenantCode, setTenantCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = mode === "create"
        ? await api.post("/auth/register", { tenant_name: tenantName, display_name: displayName })
        : await api.post("/auth/join", { tenant_code: tenantCode.trim().toUpperCase(), display_name: displayName });
      await refreshUser();
      if (data.whatsapp_gate_pending) {
        setStep("whatsapp");
      } else {
        router.replace("/dashboard");
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleWhatsAppVerified = async () => {
    await refreshUser();
    router.replace("/dashboard");
  };

  if (step === "whatsapp") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-md flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-6 h-6 text-green-600" />
            <h1 className="text-2xl font-bold text-gray-900">Vinculá tu WhatsApp</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Para terminar de configurar tu cuenta, necesitamos vincular y verificar tu número de WhatsApp. Este paso es obligatorio para poder recibir invitaciones y recordatorios.
          </p>
          <WhatsAppVerifyForm onVerified={handleWhatsAppVerified} onSkip={handleWhatsAppVerified} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-md flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-gray-900">Configurar cuenta</h1>

        <div className="flex gap-2">
          <button
            onClick={() => setMode("create")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === "create" ? "bg-primary text-white" : "border text-gray-600 hover:bg-gray-50"}`}
          >
            Crear hogar nuevo
          </button>
          <button
            onClick={() => setMode("join")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === "join" ? "bg-primary text-white" : "border text-gray-600 hover:bg-gray-50"}`}
          >
            Unirme a un hogar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Tu nombre</label>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Cómo querés que te identifiquen"
              required
            />
          </div>

          {mode === "create" ? (
            <div>
              <label className="text-sm font-medium text-gray-700">Nombre del hogar</label>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                placeholder="Ej: Casa García"
                required
              />
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium text-gray-700">{"Código del hogar"}</label>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary uppercase tracking-widest"
                value={tenantCode}
                onChange={(e) => setTenantCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())}
                placeholder="XXXXXXXX"
                maxLength={8}
                required
              />
              <p className="text-xs text-muted-foreground mt-1">El admin del hogar te comparte este código</p>
            </div>
          )}

          {error && <p className="text-destructive text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="bg-primary text-white rounded-lg py-2.5 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Configurando..." : mode === "create" ? "Crear hogar" : "Unirme"}
          </button>
        </form>
      </div>
    </div>
  );
}
