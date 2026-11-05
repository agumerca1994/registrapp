"use client";

import BusinessHome from "@/components/business/BusinessHome";
import HouseholdHome from "@/components/home/HouseholdHome";
import { useAuth } from "@/contexts/AuthContext";
import { isBusiness } from "@/lib/account";

// Inicio sigue en /dashboard para los dos tipos de cuenta: lo usan el
// `start_url` de la PWA, el login, el onboarding y "Reiniciar guía". La página
// elige qué Inicio mostrar. Lo mensual del hogar se mudó a Movimientos.
export default function DashboardPage() {
  const { appUser } = useAuth();
  return isBusiness(appUser) ? <BusinessHome /> : <HouseholdHome />;
}
