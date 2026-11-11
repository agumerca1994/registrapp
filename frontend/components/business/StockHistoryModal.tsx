"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { FormSheet } from "@/components/movimientos/FormSheet";
import { LedgerRow } from "@/components/movimientos/Ledger";
import { MotionList } from "@/components/ui/motion-list";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { ConfirmDelete } from "./ui";
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
  const [loadFailed, setLoadFailed] = useState(false);
  const reaccionar = useReaccion();
  const [open, setOpen] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoadFailed(false);
    return api.get<StockMovement[]>(`/stock/movements?product_id=${productId}&limit=30`)
      .then(({ data }) => setMoves(data)).catch(() => setLoadFailed(true));
  };
  useEffect(() => { load(); }, [productId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (m: StockMovement) => {
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/stock/movements/${m.id}`);
      setOpen(null);
      reaccionar("borrado", "Movimiento borrado");
      await load();
      await onChanged();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo borrar"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <FormSheet title={`Movimientos de ${productName}`} onClose={onClose}>
      <MotionList className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {loadFailed ? (
          <>
            <p className="py-2 text-[15px] text-foreground">No se pudieron traer los movimientos.</p>
            <button type="button" onClick={load} className="h-11 px-5 rounded-full bg-ink text-background font-semibold text-[15px]">Probar de nuevo</button>
          </>
        ) : moves === null ? (
          <div className="h-24 rounded-[22px] bg-ink/[0.05] animate-pulse" />
        ) : moves.length === 0 ? (
          <p className="py-2 text-[15px] text-muted-foreground">Todavía no tiene movimientos.</p>
        ) : moves.map((m, i) => {
          const linked = m.sale_id !== null || m.expense_entry_id !== null;
          const sub = [
            m.counted_qty !== null ? `Quedaban ${Number(m.counted_qty).toLocaleString("es-AR")}` : null,
            m.notes,
            m.expense_entry_id ? "De una compra" : null,
          ].filter(Boolean).join(". ");
          return (
            <MotionList key={m.id}>
              <LedgerRow date={m.movement_date} showDate={i === 0 || moves[i - 1].movement_date !== m.movement_date}
                title={STOCK_KIND_LABELS[m.kind]} sub={sub || undefined} amount={qtyText(Number(m.qty))}
                onOpen={() => { setError(""); setOpen(open === m.id ? null : m.id); }} />
              {open === m.id && (
                <div className="py-2.5">
                  {linked ? (
                    <p className="text-sm leading-snug text-[#4A4658]">
                      Se corrige desde {m.sale_id ? "esa venta" : "esa compra"}: si la cambiás o la borrás, el stock la sigue.
                    </p>
                  ) : (
                    <ConfirmDelete label="Borrar este movimiento" disabled={deleting} onConfirm={() => remove(m)}
                      question="¿Borrar este movimiento? El stock vuelve a como estaba." />
                  )}
                  {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
                </div>
              )}
            </MotionList>
          );
        })}
      </MotionList>
    </FormSheet>
  );
}
