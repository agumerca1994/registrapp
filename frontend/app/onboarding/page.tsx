"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import WhatsAppVerifyForm from "@/components/WhatsAppVerifyForm";
import { AtSign, MessageCircle } from "lucide-react";
import { FIELD, FormGrid } from "@/components/ui/form";
import { suggestAlias } from "@/lib/alias";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [alias, setAlias] = useState("");
  // `true` mientras el usuario no lo tocó: hasta entonces la sugerencia sigue
  // al nombre que va escribiendo. Una vez que lo edita, deja de moverse solo —
  // que un campo se reescriba mientras lo estás mirando es peor que una
  // sugerencia mediocre.
  const [aliasUntouched, setAliasUntouched] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!aliasUntouched) return;
    setAlias(suggestAlias(firstName, lastName));
  }, [firstName, lastName, aliasUntouched]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = mode === "create"
        ? await api.post("/auth/register", {
            tenant_name: tenantName, first_name: firstName, last_name: lastName,
            alias: alias.trim() || null,
          })
        : await api.post("/auth/join", {
            tenant_code: tenantCode.trim().toUpperCase(), first_name: firstName,
            last_name: lastName, alias: alias.trim() || null,
          });
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card variant="hero" className="w-full max-w-md flex flex-col gap-6 p-10">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-6 h-6 text-emerald-600" />
            <h1 className="text-2xl font-display font-bold text-foreground">Vinculá tu WhatsApp</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Para terminar de configurar tu cuenta, necesitamos vincular y verificar tu número de WhatsApp. Este paso es obligatorio para poder recibir invitaciones y recordatorios.
          </p>
          <WhatsAppVerifyForm onVerified={handleWhatsAppVerified} onSkip={handleWhatsAppVerified} />
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card variant="hero" className="w-full max-w-md flex flex-col gap-6 p-10">
        <h1 className="text-2xl font-display font-bold text-foreground">Configurar cuenta</h1>

        <div className="flex gap-2">
          <button
            onClick={() => setMode("create")}
            className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors border-2 ${mode === "create" ? "border-ink bg-primary text-primary-foreground" : "border-transparent text-muted-foreground hover:bg-accent"}`}
          >
            Crear hogar nuevo
          </button>
          <button
            onClick={() => setMode("join")}
            className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors border-2 ${mode === "join" ? "border-ink bg-primary text-primary-foreground" : "border-transparent text-muted-foreground hover:bg-accent"}`}
          >
            Unirme a un hogar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormGrid>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre</label>
              <input className={FIELD} value={firstName} required
                onChange={(e) => setFirstName(e.target.value)} placeholder="Agustín" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Apellido</label>
              <input className={FIELD} value={lastName}
                onChange={(e) => setLastName(e.target.value)} placeholder="Mercadal" />
            </div>
          </FormGrid>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Alias</label>
            <div className="relative">
              <AtSign className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                className={`${FIELD} pl-9`}
                value={alias}
                onChange={(e) => { setAlias(e.target.value.toLowerCase()); setAliasUntouched(false); }}
                placeholder="tu.alias"
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Con esto te encuentran para compartirte un gasto, sin dar tu mail
              ni tu teléfono. Lo podés cambiar después.
            </p>
          </div>

          {mode === "create" ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre del hogar</label>
              <input className={FIELD} value={tenantName} required
                onChange={(e) => setTenantName(e.target.value)} placeholder="Ej: Casa García" />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Código del hogar</label>
              <input
                className={`${FIELD} uppercase tracking-widest`}
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

          <Button type="submit" disabled={loading}>
            {loading ? "Configurando..." : mode === "create" ? "Crear hogar" : "Unirme"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
