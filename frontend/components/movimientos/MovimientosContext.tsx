"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";

export interface MonthSummary {
  total_income: number;
  total_expenses: number;
  total_expenses_usd: number;
  fx_bought_ars: number;
  fx_sold_ars: number;
  ars_available: number;
  usd_holding: number;
  usd_holding_start: number;
  usd_initial: number;
  usd_bought: number;
  usd_sold: number;
  usd_earned: number;
  usd_paid: number;
  usd_adjustments: number;
  usd_holding_ars: number | null;
  usd_rate: number | null;
  usd_rate_type: string;
  inflation_pct: number | null;
  mortgage_payment: number | null;
  mortgage_is_projected: boolean;
  expenses_by_category: {
    category_name: string; total: number; total_usd: number;
    ars_equivalent: number; color?: string;
  }[];
}

interface Ctx {
  year: number;
  month: number;
  periodLabel: string;
  prev: () => void;
  next: () => void;
  summary: MonthSummary | null;
  failed: boolean;
  /** Vuelve a pedir el resumen. Lo llama la tabla cada vez que recarga, así las dos se mueven juntas. */
  refresh: () => void;
  /** Con un filtro puesto, la tabla mira todo el historial: el resumen del mes deja de corresponder. */
  searching: boolean;
  setSearching: (v: boolean) => void;
}

const Context = createContext<Ctx | null>(null);

/**
 * Lo que comparten Egresos e Ingresos: el mes elegido y su resumen. Vive en el
 * layout de `(movimientos)`, que no se desmonta al cambiar de pestaña, así el mes
 * se conserva y la tarjeta no parpadea.
 */
export function MovimientosProvider({ children }: { children: React.ReactNode }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [searching, setSearching] = useState(false);

  const prev = useCallback(() => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1);
  }, [month]);
  const next = useCallback(() => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1);
  }, [month]);

  const refresh = useCallback(() => {
    api.get<MonthSummary>(`/dashboard/summary/${year}/${month}`)
      .then(({ data }) => { setSummary(data); setFailed(false); })
      .catch(() => setFailed(true));
  }, [year, month]);

  return (
    <Context.Provider value={{
      year, month, prev, next, summary, failed, refresh, searching, setSearching,
      periodLabel: format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: es }),
    }}>
      {children}
    </Context.Provider>
  );
}

export function useMovimientos(): Ctx {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useMovimientos va adentro de MovimientosProvider");
  return ctx;
}
