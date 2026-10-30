"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { APP_URL } from "@/lib/site";

/**
 * La raíz es la home pública, pero quien ya inició sesión va directo a la app:
 * a la pantalla de inicio, o al alta si todavía no tiene hogar o negocio. Lo
 * mismo que hacía la raíz antes de tener home. (La app instalada arranca en
 * /dashboard, así que esto sólo corre si alguien escribe la dirección.)
 */
export default function HomeRedirect() {
  const { firebaseUser, appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !firebaseUser) return;
    const path = appUser ? "/dashboard" : "/onboarding";
    // Con la app en su propio subdominio, el salto es a otro host: navegación completa, no del router.
    if (APP_URL) window.location.replace(`${APP_URL}${path}`);
    else router.replace(path);
  }, [firebaseUser, appUser, loading, router]);

  return null;
}
