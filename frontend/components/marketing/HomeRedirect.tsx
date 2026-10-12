"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

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
    router.replace(appUser ? "/dashboard" : "/onboarding");
  }, [firebaseUser, appUser, loading, router]);

  return null;
}
