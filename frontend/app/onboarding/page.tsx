"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import WhatsAppVerifyForm from "@/components/WhatsAppVerifyForm";
import { AtSign } from "lucide-react";
import { FIELD, FormGrid, SegmentedToggle } from "@/components/ui/form";
import { features } from "@/lib/features";
import { suggestAlias } from "@/lib/alias";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToodLogo } from "@/components/brand/ToodLogo";

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
  // Hogar o negocio. Sólo se pregunta con el alta de negocios abierta
  // (lib/features.ts); apagada, esta pantalla es exactamente la de siempre.
  const [kind, setKind] = useState<"household" | "business">("household");
  const business = features.businessSignup && kind === "business";
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
            ...(business ? { kind: "business" } : {}),
          })
        : await api.post("/auth/join", {
            tenant_code: tenantCode.trim().toUpperCase(), first_name: firstName,
            last_name: lastName, alias: alias.trim() || null,
          });
      // El usuario fresco y no la respuesta del alta: si llegó por el link del
      // bot, refreshUser ya vinculó el número y el paso de WhatsApp sobra.
      const fresh = await refreshUser();
      if ((fresh ?? data).whatsapp_gate_pending) {
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

  const shell = (title: string, children: React.ReactNode) => (
    <div className="min-h-screen bg-background flex flex-col justify-center"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <main className="w-full max-w-md mx-auto px-4 py-8">
        <ToodLogo className="h-8 w-auto text-primary ml-1.5" title="tood" />
        <h1 className="mt-4 mb-4 ml-1.5 text-[28px] font-display font-medium leading-tight tracking-[-0.035em] text-foreground">{title}</h1>
        {children}
      </main>
    </div>
  );

  if (step === "whatsapp") {
    return shell("Vinculá tu WhatsApp", (
      <Card className="rounded-[28px] flex flex-col gap-4">
        <p className="text-sm leading-snug text-muted-foreground">
          Falta un paso: vincular tu número de WhatsApp. Por ahí te llegan los recordatorios de pago, y podés cargar movimientos mandando un mensaje.
        </p>
        <WhatsAppVerifyForm onVerified={handleWhatsAppVerified} onSkip={handleWhatsAppVerified} />
      </Card>
    ));
  }

  return shell("Configurar cuenta", (
      <Card className="rounded-[28px] flex flex-col gap-4">
        <SegmentedToggle
          ariaLabel="Crear o unirme"
          value={mode}
          onChange={setMode}
          options={[
            { value: "create", label: features.businessSignup ? "Crear nueva" : "Crear hogar nuevo" },
            { value: "join", label: features.businessSignup ? "Unirme con un código" : "Unirme a un hogar" },
          ]}
        />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "create" && features.businessSignup && (
            <div>
              {/* El bot nombra este campo tal cual cuando explica cómo crear un negocio. */}
              <p className="text-xs font-medium text-muted-foreground mb-1">Para qué es la cuenta</p>
              <SegmentedToggle
                ariaLabel="Para qué es la cuenta"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "household", label: "Mi hogar" },
                  { value: "business", label: "Mi negocio" },
                ]}
              />
            </div>
          )}
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
              <AtSign className="w-4 h-4 text-muted-foreground absolute left-3 top-[calc(50%+2px)] -translate-y-1/2 pointer-events-none" />
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
              <label className="text-xs font-medium text-muted-foreground">
                {business ? "Nombre del negocio" : "Nombre del hogar"}
              </label>
              <input className={FIELD} value={tenantName} required
                onChange={(e) => setTenantName(e.target.value)}
                placeholder={business ? "Ej: Rotisería Don Pepe" : "Ej: Casa García"} />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {features.businessSignup ? "Código del hogar o negocio" : "Código del hogar"}
              </label>
              <input
                className={`${FIELD} uppercase tracking-widest`}
                value={tenantCode}
                onChange={(e) => setTenantCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())}
                placeholder="XXXXXXXX"
                maxLength={8}
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                {features.businessSignup ? "Te lo comparte quien lo administra" : "El admin del hogar te comparte este código"}
              </p>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}

          <Button type="submit" disabled={loading} className="h-[52px] text-[15.5px]">
            {loading ? "Configurando…" : mode === "create" ? (business ? "Crear negocio" : "Crear hogar") : "Unirme"}
          </Button>
        </form>
      </Card>
  ));
}
