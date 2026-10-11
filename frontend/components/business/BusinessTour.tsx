"use client";

import type { Step } from "react-joyride";
import ProductTour from "@/components/ProductTour";
import { useAuth } from "@/contexts/AuthContext";
import { isBusiness } from "@/lib/account";

/**
 * Un recorrido que sólo existe en cuentas de negocio. Las pantallas que
 * comparten hogar y negocio (Tarjetas, Calendario, Egresos) lo montan sin
 * condicionar nada: el recorrido del hogar sigue igual en su propia cuenta.
 */
export default function BusinessTour({ tourId, steps }: { tourId: string; steps: Step[] }) {
  const { appUser } = useAuth();
  return isBusiness(appUser) ? <ProductTour tourId={tourId} steps={steps} /> : null;
}
