"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useAuth } from "@/contexts/AuthContext";
import { isBusiness } from "@/lib/account";
import { MonthPill } from "@/components/dashboard/MonthPill";
import { MonthCard } from "@/components/movimientos/MonthCard";
import { MovimientosProvider, useMovimientos } from "@/components/movimientos/MovimientosContext";

function Overview() {
  const { year, month, prev, next, searching } = useMovimientos();
  // Corto, para que el título y el mes entren en una sola línea en un celular.
  const label = format(new Date(year, month - 1, 1), "MMM yyyy", { locale: es }).replace(".", "");
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground">Movimientos</h1>
        {!searching && <MonthPill compact label={label} onPrev={prev} onNext={next} />}
      </div>
      {!searching && <div data-tour="month-card"><MonthCard /></div>}
    </>
  );
}

/**
 * Egresos e Ingresos son una sola pantalla: el mes arriba y, según la pestaña,
 * su desglose y su tabla. Cada una conserva su ruta, porque de `/expenses?nuevo=1`
 * dependen el + y los links del bot. Un negocio no tiene ingresos ni esta tarjeta:
 * ve Egresos como siempre.
 */
export default function MovimientosLayout({ children }: { children: React.ReactNode }) {
  const { appUser } = useAuth();
  return (
    <MovimientosProvider>
      {isBusiness(appUser) ? children : (
        <div className="space-y-4 md:space-y-6">
          <Overview />
          {children}
        </div>
      )}
    </MovimientosProvider>
  );
}
