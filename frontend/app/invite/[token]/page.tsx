"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle, Users, AlertCircle, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { formatARS } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface InviteInfo {
  shared_expense_id: number;
  title: string;
  total_amount: number;
  split_amount: number;
  expense_date: string;
  creator_name: string;
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
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setClaimError(msg || "Error al reclamar la invitacion");
    } finally {
      setClaiming(false);
    }
  }

  if (authLoading || (!info && !loadError)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-sm w-full bg-white rounded-xl border p-6 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <p className="font-semibold text-gray-800">Invitacion no disponible</p>
          <p className="text-sm text-gray-600">{loadError}</p>
          <button onClick={() => router.push("/")} className="w-full py-2.5 bg-primary text-white rounded-lg text-sm font-medium">
            Ir al inicio
          </button>
        </div>
      </div>
    );
  }

  if (claimed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-sm w-full bg-white rounded-xl border p-6 text-center space-y-4">
          <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
          <p className="font-semibold text-gray-800">Invitacion reclamada</p>
          <p className="text-sm text-gray-600">Redirigiendo a Gastos Compartidos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-sm w-full space-y-4">
        <div className="text-center">
          <Users className="w-10 h-10 text-primary mx-auto mb-2" />
          <h1 className="text-xl font-bold text-gray-900">Gasto compartido</h1>
          <p className="text-sm text-gray-500 mt-1">Te invitaron a compartir un gasto</p>
        </div>

        {info && (
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Descripcion</p>
              <p className="font-semibold text-gray-900">{info.title}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Total del gasto</p>
                <p className="font-semibold text-gray-900">{formatARS(info.total_amount)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Tu parte</p>
                <p className="font-bold text-lg text-primary">{formatARS(info.split_amount)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Creado por</p>
              <p className="text-sm text-gray-700">{info.creator_name}</p>
            </div>
          </div>
        )}

        {claimError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 text-center">{claimError}</p>
        )}

        {appUser ? (
          <div className="space-y-2">
            <button
              onClick={handleClaim}
              disabled={claiming}
              className="w-full py-3 bg-primary text-white rounded-lg font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {claiming ? "Procesando..." : "Aceptar y agregar a mis gastos"}
            </button>
            <p className="text-xs text-center text-gray-500">
              Sesion iniciada como <strong>{appUser.display_name || appUser.email}</strong>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-center text-gray-600">
              Inicia sesion para aceptar este gasto compartido
            </p>
            <button
              onClick={() => router.push(`/login?invite_token=${token}`)}
              className="w-full py-3 bg-primary text-white rounded-lg font-medium text-sm"
            >
              Iniciar sesion
            </button>
            <button
              onClick={() => router.push(`/onboarding?invite_token=${token}`)}
              className="w-full py-2.5 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              Crear cuenta nueva
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
