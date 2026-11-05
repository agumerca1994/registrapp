"use client";

import { format } from "date-fns";
import { ledgerAmount } from "@/components/movimientos/Ledger";
import { PAYMENT_METHOD_LABELS, saleSummary, type Product, type Sale } from "@/lib/sales";

export const saleTime = (sale: Sale) => format(new Date(sale.created_at + "Z"), "HH:mm");

/**
 * Una venta del día, con la forma de `LedgerRow`: en una lista de un solo día lo
 * que ordena no es la fecha sino la hora, que va en el mismo lugar y con el mismo gesto.
 */
export function SaleRow({ sale, products, onOpen }: { sale: Sale; products: Product[]; onOpen: () => void }) {
  const [hour, minutes] = saleTime(sale).split(":");
  return (
    <button type="button" onClick={onOpen} data-testid="sale-row"
      data-no-press className="w-full min-h-[64px] py-2 flex items-center gap-3 md:gap-4 text-left border-b border-border last:border-b-0 active:opacity-60 transition-opacity">
      <span className="w-[46px] shrink-0 flex items-baseline" aria-label={`${hour}:${minutes}`}>
        <span aria-hidden="true" className="font-fecha italic text-[30px] leading-none text-[#3B2FB3]">{hour}</span>
        <span aria-hidden="true" className="font-marca text-xs text-muted-foreground">:{minutes}</span>
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-[15.5px] text-foreground truncate">{saleSummary(sale, products)}</span>
        <span className="block text-sm text-muted-foreground truncate">{sale.payments.map(p => PAYMENT_METHOD_LABELS[p.method]).join(" + ")}</span>
      </span>
      <span className="shrink-0 font-medium text-base text-right tabular-nums text-emerald-800">{ledgerAmount(sale.total)}</span>
    </button>
  );
}
