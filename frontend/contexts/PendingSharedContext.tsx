"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "@/lib/api";

/**
 * Gastos compartidos esperando la decisión de este usuario.
 *
 * Existe porque hasta ahora un gasto compartido sólo se anunciaba dentro de
 * /shared: si no entrabas ahí, no te enterabas. Esta es la fuente única de la
 * que se alimentan las dos cosas que ahora sí lo anuncian — el diálogo del
 * primer ingreso y el puntito de la navegación. Una sola fuente a propósito:
 * dos endpoints contestando "cuántos hay pendientes" es el par que se
 * desincroniza, y el síntoma sería un puntito encendido sin nada atrás.
 *
 * Devuelve las filas y no un conteo porque el diálogo necesita los montos.
 */

export interface PendingSplit {
  id: number;
  user_id: number | null;
  member_name: string;
  amount: string | number;
  status: "pending" | "accepted" | "rejected";
  mine: boolean;
  converted_ars_amount?: string | number | null;
}

export interface PendingShared {
  id: number;
  title: string;
  total_amount: string | number;
  currency: string;
  expense_date: string;
  payment_date: string;
  created_by_user_id: number;
  installment_group_id?: number | null;
  splits: PendingSplit[];
}

interface Ctx {
  pending: PendingShared[];
  count: number;
  /** Vuelve a preguntar al backend. La llama /shared después de aceptar o
   *  rechazar, para que el puntito no quede encendido de más. */
  refresh: () => Promise<void>;
  accept: (id: number) => Promise<void>;
  reject: (id: number) => Promise<void>;
}

const PendingSharedContext = createContext<Ctx>({
  pending: [],
  count: 0,
  refresh: async () => {},
  accept: async () => {},
  reject: async () => {},
});

export function PendingSharedProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingShared[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<PendingShared[]>("/shared-expenses/pending");
      setPending(res.data);
    } catch {
      // Un fallo acá no puede romper la pantalla: lo único que se pierde es el
      // aviso, y la sección sigue estando donde estaba.
      setPending([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Se resuelve contra el backend y se saca de la lista local en el mismo paso:
  // el diálogo pagina sobre esta lista, así que un refetch de ida y vuelta le
  // movería las páginas abajo de los pies.
  const resolveOne = useCallback(async (id: number, action: "accept" | "reject") => {
    await api.post(`/shared-expenses/${id}/${action}`);
    setPending(prev => prev.filter(p => p.id !== id));
  }, []);

  const accept = useCallback((id: number) => resolveOne(id, "accept"), [resolveOne]);
  const reject = useCallback((id: number) => resolveOne(id, "reject"), [resolveOne]);

  return (
    <PendingSharedContext.Provider
      value={{ pending, count: pending.length, refresh, accept, reject }}
    >
      {children}
    </PendingSharedContext.Provider>
  );
}

/**
 * Suscribe al componente a los pendientes.
 *
 * Ojo con la misma trampa que documenta PrivacyProvider: las pantallas llegan
 * como `children` del provider, así que su identidad de elemento no cambia
 * cuando cambia el estado del provider y React no las re-renderiza. Un
 * componente que quiera reaccionar (el puntito, el diálogo) tiene que llamar
 * a este hook, no leer el valor por otro camino.
 */
export function usePendingShared() {
  return useContext(PendingSharedContext);
}
