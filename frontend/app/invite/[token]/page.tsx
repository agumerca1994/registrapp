"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle, Users, AlertCircle, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { formatARS, getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";

interface InviteInfo {
  shared_expense_id: number;
  title: string;
  total_amount: number;
  split_amount: number;
  expense_date: string;
  creator_name: string;
  cuotas_count: number;
  cuotas_total_amount: number | null;
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
        if (status === 404) setLoadError("Esta invitacion no existe o ya fue reclamada.");
        else if (status === 410) setLoadError("Esta invitacion ha expirado (mas de 30 dias).");
        else setLoadError("No se pudo cargar la invitacion. Intenta de nuevo.");
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
      setClaimError(getErrorMessage(err, "Error al reclamar la invitacion"));
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
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card variant="hero" className="max-w-sm w-full text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
          <p className="font-semibold text-foreground">Invitacion no disponible</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button onClick={() => router.push("/")} className="w-full">
            Ir al inicio
          </Button>
        </Card>
      </div>
    );
  }

  if (claimed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card variant="hero" className="max-w-sm w-full text-center space-y-4">
          <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto" />
          <p className="font-semibold text-foreground">Invitacion reclamada</p>
          <p className="text-sm text-muted-foreground">Redirigiendo a Gastos Compartidos...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-sm w-full space-y-4">
        <div className="text-center">
          <Users className="w-10 h-10 text-primary mx-auto mb-2" />
          <h1 className="text-xl font-display font-bold text-foreground">Gasto compartido</h1>
          <p className="text-sm text-muted-foreground mt-1">Te invitaron a compartir un gasto</p>
        </div>

        {info && (
          <Card variant="hero" className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Descripción</p>
              <p className="font-semibold text-foreground">
                {info.title}
                {info.cuotas_count > 1 && (
                  <Chip tone="violet" className="ml-2 align-middle">
                    {info.cuotas_count} cuotas
                  </Chip>
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{info.cuotas_count > 1 ? "Monto por cuota" : "Total del gasto"}</p>
                <p className="font-semibold text-foreground">{formatARS(info.total_amount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{info.cuotas_count > 1 ? "Tu parte por cuota" : "Tu parte"}</p>
                <p className="font-bold text-lg text-primary">{formatARS(info.split_amount)}</p>
              </div>
            </div>
            {info.cuotas_count > 1 && info.cuotas_total_amount !== null && (
              <div className="bg-accent rounded-lg px-3 py-2">
                <p className="text-xs text-primary">
                  Se van a compartir las <strong>{info.cuotas_count} cuotas</strong> de esta compra, una por mes.
                  Tu parte total sumando todas las cuotas es <strong>{formatARS(info.cuotas_total_amount)}</strong>.
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Creado por</p>
              <p className="text-sm text-foreground">{info.creator_name}</p>
            </div>
          </Card>
        )}

        {claimError && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 text-center">{claimError}</p>
        )}

        {appUser ? (
          <div className="space-y-2">
            <Button onClick={handleClaim} disabled={claiming} className="w-full">
              {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {claiming ? "Procesando..." : info && info.cuotas_count > 1 ? `Aceptar las ${info.cuotas_count} cuotas` : "Aceptar y agregar a mis gastos"}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Sesión iniciada como <strong>{appUser.display_name || appUser.email}</strong>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-center text-muted-foreground">
              Inicia sesión para aceptar este gasto compartido
            </p>
            <Button
              onClick={() => {
                localStorage.setItem("pendingInviteToken", token);
                router.push("/login");
              }}
              className="w-full"
            >
              Iniciar sesión
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                localStorage.setItem("pendingInviteToken", token);
                router.push("/login");
              }}
              className="w-full"
            >
              Crear cuenta nueva
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
