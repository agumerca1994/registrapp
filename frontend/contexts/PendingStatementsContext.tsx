"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "@/lib/api";
import { features } from "@/lib/features";

/**
 * Resúmenes subidos que todavía esperan una decisión de este hogar.
 *
 * Gemelo de PendingSharedContext y por el mismo motivo: "Subir resumen" ya no
 * tiene una sección propia en la navegación, así que un resumen a medio
 * revisar sólo se anuncia por el puntito de Tarjetas y la tarjeta "Resúmenes
 * por revisar". Una sola fuente para los dos, así no pueden discrepar.
 *
 * `needs_choice` puede venir con `pending_count` 0: lo que falta ahí es elegir
 * tarjeta o resumen, no revisar renglones, y cuenta como pendiente igual.
 */

export interface PendingStatement {
  id: number;
  status: string;
  bank: string | null;
  card_id: number | null;
  period_year: number | null;
  period_month: number | null;
  pending_count: number;
  created_at: string | null;
}

interface Ctx {
  pending: PendingStatement[];
  count: number;
  /** Vuelve a preguntar al backend. La llama la pantalla de revisión después
   *  de aplicar o deshacer, para que el puntito no quede encendido de más. */
  refresh: () => Promise<void>;
}

const PendingStatementsContext = createContext<Ctx>({
  pending: [],
  count: 0,
  refresh: async () => {},
});

export function PendingStatementsProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingStatement[]>([]);

  const refresh = useCallback(async () => {
    if (!features.reconcile) return;
    try {
      const res = await api.get<PendingStatement[]>("/reconcile/pending");
      setPending(res.data);
    } catch {
      // Un fallo acá no puede romper la pantalla: lo único que se pierde es el
      // aviso.
      setPending([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <PendingStatementsContext.Provider value={{ pending, count: pending.length, refresh }}>
      {children}
    </PendingStatementsContext.Provider>
  );
}

/**
 * Suscribe al componente a los resúmenes pendientes. Misma trampa que
 * usePendingShared: las pantallas llegan como `children` del provider y React
 * no las re-renderiza cuando cambia su estado, así que todo lo que pinte el
 * puntito o la lista tiene que llamar a este hook.
 */
export function usePendingStatements() {
  return useContext(PendingStatementsContext);
}
