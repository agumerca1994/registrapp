"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CheckCircle, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { formatARS, formatUSD, getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { ToodLogo } from "@/components/brand/ToodLogo";
import { Card } from "@/components/ui/card";

interface InviteInfo {
  shared_expense_id: number;
  title: string;
  total_amount: number;
  currency: "ARS" | "USD";
  split_amount: number;
  expense_date: string;
  creator_name: string;
  cuotas_count: number;
  cuotas_total_amount: number | null;
}

const PRIMARY = "w-full h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform duration-100";
const SECONDARY = "w-full h-[52px] rounded-full border border-border bg-card font-semibold text-[15px] text-foreground active:scale-[0.98] transition-transform duration-100";

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className="max-w-sm w-full space-y-4">
        <ToodLogo className="h-8 w-auto text-primary mx-auto" />
        {children}
      </div>
    </div>
  );
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { appUser, loading: authLoading } = useAuth();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.get(`/shared-expenses/invite/${token}`)
      .then(r => setInfo(r.data))
      .catch(err => {
        const status = err?.response?.status;
        if (status === 404) setLoadError("Esta invitación no existe o ya la aceptó alguien.");
        else if (status === 410) setLoadError("Esta invitación venció: duran 30 días. Pedile a quien te la mandó que la comparta de nuevo.");
        else setLoadError("No se pudo cargar la invitación. Probá de nuevo.");
      });
  }, [token]);

  async function handleClaim() {
    setClaiming(true);
    setClaimError(null);
    try {
      await api.post(`/shared-expenses/invite/${token}/claim`);
      setClaimed(true);
      setTimeout(() => router.push("/shared"), 2000);
    } catch (err: unknown) {
      setClaimError(getErrorMessage(err, "No se pudo aceptar la invitación"));
    } finally {
      setClaiming(false);
    }
  }

  if (authLoading || (!info && !loadError)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Page>
        <Card className="space-y-3 animate-fade-in">
          <h1 className="text-[22px] font-medium tracking-[-0.03em] text-foreground">Invitación no disponible</h1>
          <p className="text-[15px] text-muted-foreground">{loadError}</p>
          <button type="button" onClick={() => router.push("/")} className={PRIMARY}>Ir al inicio</button>
        </Card>
      </Page>
    );
  }

  if (claimed) {
    return (
      <Page>
        <Card className="space-y-2 animate-fade-in">
          <h1 className="text-[22px] font-medium tracking-[-0.03em] text-foreground">Invitación aceptada</h1>
          <p className="text-[15px] text-muted-foreground">Te llevamos a Compartidos…</p>
        </Card>
      </Page>
    );
  }

  const money = (n: number) => (info?.currency === "USD" ? formatUSD(n) : formatARS(n));
  const plan = !!info && info.cuotas_count > 1;

  return (
    <Page>
      {info && (
        <Card className="animate-fade-in">
          <p className="font-marca text-xs text-muted-foreground">
            {format(parseISO(info.expense_date), "EEE d MMM yyyy", { locale: es }).replace(/\./g, "")}
          </p>
          <h1 className="mt-2.5 text-sm text-[#4A4658]">
            {info.creator_name} te invitó a compartir un gasto
          </h1>
          <p className="mt-1 text-[19px] font-semibold leading-snug tracking-[-0.01em] text-foreground">{info.title}</p>

          <p className="mt-3 text-sm text-[#4A4658]">{plan ? "Tu parte por cuota" : "Tu parte"}</p>
          <p className="font-medium text-[44px] leading-[1.1] tracking-[-0.04em] tabular-nums break-words text-foreground">
            {money(info.split_amount)}
          </p>

          <div className="mt-3 border-t border-border">
            <div className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
              <span className="text-[#4A4658]">{plan ? "Monto por cuota" : "Total del gasto"}</span>
              <span className="font-medium tabular-nums text-foreground">{money(info.total_amount)}</span>
            </div>
          </div>

          {plan && info.cuotas_total_amount !== null && (
            <p className="mt-1 rounded-2xl bg-accent border border-[#CFC9E4] px-3.5 py-2.5 text-sm text-foreground">
              Se van a compartir las <strong className="font-semibold">{info.cuotas_count} cuotas</strong> de esta compra, una por mes.
              Tu parte total sumando todas las cuotas es <strong className="font-semibold tabular-nums">{money(info.cuotas_total_amount)}</strong>.
            </p>
          )}
        </Card>
      )}

      {claimError && (
        <p role="alert" className="text-sm text-destructive bg-destructive/10 rounded-2xl px-3.5 py-2.5 text-center">{claimError}</p>
      )}

      {appUser ? (
        <div className="space-y-2">
          <button type="button" onClick={handleClaim} disabled={claiming} className={PRIMARY}>
            {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            {claiming ? "Aceptando…" : plan ? `Aceptar las ${info?.cuotas_count} cuotas` : "Aceptar y agregar a mis gastos"}
          </button>
          <p className="text-sm text-center text-muted-foreground">
            Sesión iniciada como <span className="font-medium text-foreground">{appUser.display_name || appUser.email}</span>
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[15px] text-center text-muted-foreground">
            Iniciá sesión para aceptar este gasto compartido
          </p>
          <button type="button" className={PRIMARY}
            onClick={() => {
              localStorage.setItem("pendingInviteToken", token);
              router.push("/login");
            }}
          >
            Iniciar sesión
          </button>
          <button type="button" className={SECONDARY}
            onClick={() => {
              localStorage.setItem("pendingInviteToken", token);
              router.push("/login");
            }}
          >
            Crear cuenta nueva
          </button>
        </div>
      )}
    </Page>
  );
}
