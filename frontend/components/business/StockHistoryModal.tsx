"use client";

import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import api from "@/lib/api";
import { formatDate, getErrorMessage } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { STOCK_KIND_LABELS, type StockMovement } from "./types";

const qtyText = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString("es-AR", { maximumFractionDigits: 3 })}`;

/**
 * Los últimos movimientos de un producto. Los que se cargaron a mano se pueden
 * borrar (una producción mal cargada); los que salen de una venta o de una
 * compra se corrigen desde ahí, y acá lo dicen.
 */
export function StockHistoryModal({ productId, productName, onChanged, onClose }: {
  productId: number;
  productName: string;
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [moves, setMoves] = useState<StockMovement[] | null>(null);
  const [error, setError] = useState("");

  const load = () => api.get<StockMovement[]>(`/stock/movements?product_id=${productId}&limit=30`)
    .then(({ data }) => setMoves(data)).catch(() => setMoves([]));
  useEffect(() => { load(); }, [productId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (m: StockMovement) => {
    if (!confirm("¿Borrar este movimiento?")) return;
    try {
      await api.delete(`/stock/movements/${m.id}`);
      await load();
      await onChanged();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo borrar"));
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground truncate">Movimientos de {productName}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        {moves === null ? (
          <div className="h-24 rounded-xl bg-muted animate-pulse" />
        ) : moves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no tiene movimientos.</p>
        ) : (
          <div className="divide-y rounded-xl border">
            {moves.map(m => {
              const qty = Number(m.qty);
              const linked = m.sale_id !== null || m.expense_entry_id !== null;
              return (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      {STOCK_KIND_LABELS[m.kind]}
                      {m.counted_qty !== null && <span className="text-muted-foreground"> · quedaban {Number(m.counted_qty).toLocaleString("es-AR")}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {formatDate(m.movement_date)}{m.notes ? ` · ${m.notes}` : ""}{linked ? (m.sale_id ? " · de una venta" : " · de una compra") : ""}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${qty < 0 ? "text-rose-600" : "text-emerald-700"}`}>{qtyText(qty)}</span>
                  {!linked && (
                    <button onClick={() => remove(m)} title="Borrar" className="p-1 text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>
    </div>
  );
}
