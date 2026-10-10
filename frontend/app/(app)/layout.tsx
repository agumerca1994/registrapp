"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import api from "@/lib/api";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import Sidebar from "@/components/layout/Sidebar";
import { ScrollToTop } from "@/components/ScrollToTop";
import { ErrorReporter } from "@/components/ErrorReporter";
import { PrivacyProvider } from "@/contexts/PrivacyContext";
import { PendingSharedProvider } from "@/contexts/PendingSharedContext";
import { PendingStatementsProvider } from "@/contexts/PendingStatementsContext";
import { PendingSharedDialog } from "@/components/PendingSharedDialog";
import { WhatsNewCarousel } from "@/components/WhatsNewCarousel";
import { syncPushToken } from "@/lib/push";
import { ensureServiceWorker } from "@/lib/sw";
import { stashPendingRoute, takePendingRoute } from "@/lib/pending-route";
import { homeFor, isBusiness, isEmployee, routeAllowed } from "@/lib/account";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { firebaseUser, appUser, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // `?wat=` es el token de auto-login de los links del bot de WhatsApp: un
  // solo uso, 15 minutos, canjeable por un custom token de Firebase. Existe
  // porque esos links se abren en el navegador interno de WhatsApp, donde el
  // login de Google directamente no funciona. El ref evita el doble canje de
  // StrictMode — el segundo intento quemaría un 401 contra un token ya usado.
  const watTried = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      const wat = new URLSearchParams(window.location.search).get("wat");
      if (wat && !watTried.current) {
        watTried.current = true;
        (async () => {
          try {
            const { data } = await api.post("/auth/wa-link", { token: wat });
            await signInWithCustomToken(auth, data.custom_token);
            // El token ya se gastó: fuera de la URL, que no viaje en un
            // compartir ni quede en el historial.
            const url = new URL(window.location.href);
            url.searchParams.delete("wat");
            window.history.replaceState(null, "", url.pathname + url.search);
          } catch {
            // Vencido o ya usado: el camino normal (y en Android el navegador
            // real comparte sesión con la PWA, así que suele entrar igual).
            stashPendingRoute();
            router.replace("/login");
          }
        })();
        return;
      }
      if (wat) return; // canje en curso: no rebotar a /login por abajo
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

  // Un negocio no tiene las pantallas del hogar (divisas, hipoteca…) ni al
  // revés: una ruta que no es de esta cuenta —un link viejo, un tipeo— va a
  // Inicio en vez de mostrar una pantalla a la que el backend le va a decir
  // que no a todo. Las rutas de cada tipo están en lib/account.ts.
  useEffect(() => {
    if (!appUser || appUser.whatsapp_gate_pending || !pathname) return;
    if (!routeAllowed(pathname, appUser)) router.replace(homeFor(appUser));
  }, [appUser, pathname, router]);

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
  // Redirigiendo a Inicio (ver arriba): no pintar la pantalla que no va.
  if (pathname && !routeAllowed(pathname, appUser)) return null;

  const shell = (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <ScrollToTop />
      <ErrorReporter />
      <main id="main-content" className="flex-1 p-4 md:p-8 overflow-auto pt-20 pb-28 md:pt-8 md:pb-8">
        {children}
      </main>
    </div>
  );

  return (
    // Wraps every protected screen: hiding amounts on one and not the others
    // would be worse than not hiding them at all.
    <PrivacyProvider>
      {isEmployee(appUser) ? (
        // Un empleado no ve tarjetas ni resúmenes: sin el provider, el puntito
        // lee su valor por defecto y no se le pide al backend algo que le
        // contestaría 403 (y que quedaría en AppLog como error).
        shell
      ) : isBusiness(appUser) ? (
        // Un negocio no tiene gastos compartidos ni (todavía) un carrusel de
        // novedades propio. Sin el provider de compartidos, el puntito de la
        // navegación lee su valor por defecto: cero, sin pedirle nada al backend.
        <PendingStatementsProvider>{shell}</PendingStatementsProvider>
      ) : (
        /* Envuelve todo por la misma razón que PrivacyProvider: el puntito de la
           navegación y el aviso del primer ingreso tienen que leer los mismos
           pendientes, y la navegación está en todas las pantallas. */
        <PendingSharedProvider>
        <PendingStatementsProvider>
          {shell}
          <PendingSharedDialog />
          {/* Cede ante el aviso de pendientes y ante una guía corriendo: nunca
              dos overlays a la vez (ver el componente). */}
          <WhatsNewCarousel />
        </PendingStatementsProvider>
        </PendingSharedProvider>
      )}
    </PrivacyProvider>
  );
}
