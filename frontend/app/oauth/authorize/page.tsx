"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Eye, Loader2, Lock, Plug } from "lucide-react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";

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
        else if (status === 410) setLoadError("La solicitud expiró. Volvé a intentar desde la app.");
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
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-ink bg-primary/10 flex items-center justify-center shrink-0">
        <Plug className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0">
        <h1 className="font-display font-bold text-lg text-foreground truncate">
          {info.client_name}
        </h1>
        <p className="text-xs text-muted-foreground truncate">quiere conectarse a RegistrApp</p>
      </div>
    </div>
  );

  if (!firebaseUser) {
    return (
      <Shell>
        {header}
        <p className="text-sm text-muted-foreground">
          Iniciá sesión con Google para decidir si le das acceso a los datos de tu hogar.
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
          Antes de conectar una app necesitás crear o unirte a un hogar en RegistrApp.
        </p>
        <Button asChild className="w-full">
          <a href="/onboarding">Ir a crear mi hogar</a>
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
            <strong>Va a poder leer</strong> los ingresos, gastos, tarjetas, cuotas,
            hipoteca y tenencia en dólares de tu hogar.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Lock className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <p className="text-sm text-foreground">
            <strong>No va a poder</strong> modificar, crear ni borrar nada.
          </p>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
        <p>
          Conectado como <strong className="text-foreground">{appUser.email}</strong>
        </p>
        <p>
          Te va a devolver a <span className="font-mono">{info.redirect_host}</span>
        </p>
        <div className="flex flex-wrap gap-1 pt-1">
          {info.scopes.map(s => (
            <Chip key={s} tone="emerald">
              {s === "registrapp:read" ? "Solo lectura" : s}
            </Chip>
          ))}
        </div>
      </div>

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <div className="flex gap-2">
        <Button onClick={() => decide("consent")} disabled={busy} className="flex-1">
          {busy ? "..." : "Autorizar"}
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
