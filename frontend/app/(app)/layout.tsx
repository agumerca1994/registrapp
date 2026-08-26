"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Sidebar from "@/components/layout/Sidebar";
import { ScrollToTop } from "@/components/ScrollToTop";
import { ErrorReporter } from "@/components/ErrorReporter";
import { PrivacyProvider } from "@/contexts/PrivacyContext";
import { PendingSharedProvider } from "@/contexts/PendingSharedContext";
import { PendingSharedDialog } from "@/components/PendingSharedDialog";
import { syncPushToken } from "@/lib/push";
import { ensureServiceWorker } from "@/lib/sw";
import { stashPendingRoute, takePendingRoute } from "@/lib/pending-route";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { firebaseUser, appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      // Guardar a dónde iba antes de mandarlo a loguearse. Sin esto, un deep
      // link con datos en el querystring —que es exactamente lo que produce la
      // hoja de compartir y el Atajo de iOS— llega, rebota a /login y vuelve al
      // dashboard con el gasto perdido: el usuario compartió un comprobante y
      // no pasó nada, sin ningún error que lo explique.
      //
      // Es la misma forma que `pendingInviteToken`, que existe por el mismo
      // motivo. sessionStorage y no localStorage a propósito: si esto sobrevive
      // al cierre del navegador, la próxima sesión arranca saltando a una
      // pantalla que el usuario ya no pidió.
      stashPendingRoute();
      router.replace("/login");
    } else if (!appUser || appUser.whatsapp_gate_pending) {
      router.replace("/onboarding");
    }
  }, [firebaseUser, appUser, loading, router]);

  // Y al volver con sesión, retomarlo. Se consume una sola vez.
  useEffect(() => {
    if (!appUser || appUser.whatsapp_gate_pending) return;
    const target = takePendingRoute();
    if (target) router.replace(target);
  }, [appUser, router]);

  // FCM rota el token cuando quiere y deja de entregar al viejo sin avisar. Si
  // nadie lo vuelve a registrar, los avisos se cortan en algún momento y no hay
  // nada en la app que lo delate. No hace nada si no hay permiso.
  useEffect(() => {
    if (!appUser) return;
    syncPushToken().catch(() => {});
  }, [appUser]);

  // El service worker se registra SIEMPRE, no sólo con permiso de push. El
  // mismo SW recibe lo que llega por la hoja de compartir de Android, y antes
  // el registro vivía adentro de `enablePush()`: en un teléfono que había dicho
  // que no a las notificaciones el SW no existía, así que compartir un
  // comprobante no hacía nada — sin error, y sólo para esas personas.
  // Es idempotente y usa la misma URL exacta que el push (ver lib/sw.ts).
  useEffect(() => {
    if (!appUser) return;
    ensureServiceWorker().catch(() => {});
  }, [appUser]);

  if (loading || !appUser || appUser.whatsapp_gate_pending) return null;

  return (
    // Wraps every protected screen: hiding amounts on one and not the others
    // would be worse than not hiding them at all.
    <PrivacyProvider>
      {/* Envuelve todo por la misma razón que PrivacyProvider: el puntito de la
          navegación y el aviso del primer ingreso tienen que leer los mismos
          pendientes, y la navegación está en todas las pantallas. */}
      <PendingSharedProvider>
        <div className="flex min-h-screen bg-background">
          <Sidebar />
          <ScrollToTop />
          <ErrorReporter />
          <main id="main-content" className="flex-1 p-4 md:p-8 overflow-auto pt-20 pb-28 md:pt-8 md:pb-8">
            {children}
          </main>
        </div>
        <PendingSharedDialog />
      </PendingSharedProvider>
    </PrivacyProvider>
  );
}
