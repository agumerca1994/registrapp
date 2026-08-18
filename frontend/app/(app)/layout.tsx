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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { firebaseUser, appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) router.replace("/login");
    else if (!appUser || appUser.whatsapp_gate_pending) router.replace("/onboarding");
  }, [firebaseUser, appUser, loading, router]);

  // FCM rota el token cuando quiere y deja de entregar al viejo sin avisar. Si
  // nadie lo vuelve a registrar, los avisos se cortan en algún momento y no hay
  // nada en la app que lo delate. No hace nada si no hay permiso.
  useEffect(() => {
    if (!appUser) return;
    syncPushToken().catch(() => {});
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
