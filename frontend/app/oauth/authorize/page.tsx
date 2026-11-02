"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Eye, Loader2, Pencil } from "lucide-react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { connectorScopeLabel, isBusiness } from "@/lib/account";
import AvatarConIA from "@/components/marketing/connect/AvatarConIA";

// Deliberately outside the (app) route group: that layout bounces anyone
// without a session to /login, which would drop the ?txn= and break the OAuth
// flow. Users arrive here straight from Claude's browser, often logged out.

interface TxnInfo {
  txn: string;
  client_name: string;
  client_uri: string | null;
  logo_uri: string | null;
  redirect_host: string;
  scopes: string[];
}

// Una app de escritorio o de terminal (Claude Code) recibe la respuesta en un puerto de la misma máquina.
// "localhost:54982" es correcto pero se lee como un error: se dice qué significa. Otro dominio se muestra tal
// cual, porque es el dato que permite notar un destino raro.
function isLoopback(host: string) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card variant="hero" className="w-full max-w-md p-6 space-y-5">{children}</Card>
    </div>
  );
}

function AuthorizeInner() {
  const txn = useSearchParams().get("txn");
  const { firebaseUser, appUser, loading: authLoading, loginWithGoogle } = useAuth();

  const [info, setInfo] = useState<TxnInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!txn) {
      setLoadError("Falta el identificador de la solicitud.");
      return;
    }
    api
      .get<TxnInfo>(`/oauth/authorize/txn/${txn}`)
      .then(r => setInfo(r.data))
      .catch(err => {
        const status = err?.response?.status;
        if (status === 404) setLoadError("Esta solicitud no existe o ya fue usada.");
        else if (status === 410) setLoadError("La solicitud venció. Volvé a conectar desde el asistente.");
        else setLoadError("No se pudo cargar la solicitud. Probá de nuevo.");
      });
  }, [txn]);

  const decide = async (path: "consent" | "deny") => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.post<{ redirect_uri: string }>(`/oauth/authorize/${path}`, { txn });
      window.location.replace(res.data.redirect_uri);
    } catch (err) {
      setActionError(getErrorMessage(err, "No se pudo completar la solicitud"));
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="w-5 h-5" />
          <h1 className="font-semibold">No se puede continuar</h1>
        </div>
        <p className="text-sm text-muted-foreground">{loadError}</p>
      </Shell>
    );
  }

  if (!info || authLoading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  const header = (
    <div className="text-center">
      <AvatarConIA className="w-full max-w-[320px] mx-auto h-auto" surface="bg-card" />
      <h1 className="font-display font-bold text-lg text-foreground break-words">
        {info.client_name}
      </h1>
      <p className="text-sm text-muted-foreground">quiere conectarse a tood</p>
    </div>
  );

  if (!firebaseUser) {
    return (
      <Shell>
        {header}
        <p className="text-sm text-muted-foreground">
          Iniciá sesión con Google para decidir si le das acceso a tu cuenta.
        </p>
        <Button onClick={loginWithGoogle} className="w-full">
          Continuar con Google
        </Button>
      </Shell>
    );
  }

  if (!appUser) {
    return (
      <Shell>
        {header}
        <p className="text-sm text-muted-foreground">
          Antes de conectar una app necesitás crear tu cuenta en tood, o unirte a una con un código.
        </p>
        <Button asChild className="w-full">
          <a href="/onboarding">Crear mi cuenta</a>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      {header}

      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <Eye className="w-4 h-4 mt-0.5 text-emerald-700 shrink-0" />
          <p className="text-sm text-foreground">
            {isBusiness(appUser) ? (
              <><strong>Lectura:</strong> ventas, gastos, stock, proveedores y tarjetas de tu
              negocio.</>
            ) : (
              <><strong>Lectura:</strong> ingresos, gastos, tarjetas, cuotas, gastos compartidos,
              hipoteca y dólares de tu hogar.</>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Pencil className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <p className="text-sm text-foreground">
            {isBusiness(appUser) ? (
              <><strong>Escritura:</strong> ventas, cierre del día, stock, productos, gastos y
              tarjetas. Puede cargar, editar y borrar. Cada cambio arranca como vista previa y se
              guarda cuando lo confirmás.</>
            ) : (
              <><strong>Escritura:</strong> gastos, ingresos, tarjetas y gastos compartidos. Puede
              cargar, editar y borrar, y avisarle a quien compartas. Cada cambio arranca como vista
              previa y se guarda cuando lo confirmás.</>
            )}
          </p>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
        <p>
          Conectado como <strong className="text-foreground">{appUser.email}</strong>
        </p>
        <p>
          {isLoopback(info.redirect_host) ? (
            "Al terminar volvés a la app que abriste en esta compu."
          ) : (
            <>Al terminar volvés a <span className="font-mono">{info.redirect_host}</span></>
          )}
        </p>
        <div className="flex flex-wrap gap-1 pt-1">
          {info.scopes.map(s => (
            <Chip key={s} tone="emerald">
              {s === "registrapp:read" ? connectorScopeLabel() : s}
            </Chip>
          ))}
        </div>
      </div>

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <div className="flex gap-2">
        <Button onClick={() => decide("consent")} disabled={busy} className="flex-1">
          {busy ? "Autorizando…" : "Autorizar"}
        </Button>
        <Button variant="outline" onClick={() => decide("deny")} disabled={busy} className="flex-1">
          Cancelar
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Podés desconectar esta app cuando quieras desde Configuración.
      </p>
    </Shell>
  );
}

export default function AuthorizePage() {
  // useSearchParams needs a Suspense boundary or `next build` fails.
  return (
    <Suspense
      fallback={
        <Shell>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </Shell>
      }
    >
      <AuthorizeInner />
    </Suspense>
  );
}
