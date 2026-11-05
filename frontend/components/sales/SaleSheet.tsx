"use client";

import { useState } from "react";
import api from "@/lib/api";
import { formatARS, getErrorMessage } from "@/lib/utils";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { EntrySheet, SheetActions, SheetRow } from "@/components/movimientos/EntrySheet";
import { saleTime } from "@/components/sales/SaleRow";
import { PAYMENT_METHOD_LABELS, saleSummary, type Product, type Sale } from "@/lib/sales";

const lineName = (line: Sale["lines"][number], products: Product[]) =>
  line.product_id ? products.find(p => p.id === line.product_id)?.name ?? "Producto" : line.description ?? "";

/** La ficha de una venta: cuánto y qué se vendió, y lo que agrega algo a eso. */
export function SaleSheet({ sale, products, dayClosed, onEdit, onDeleted, onClose }: {
  sale: Sale;
  products: Product[];
  dayClosed: boolean;
  onEdit: () => void;
  onDeleted: () => void | Promise<void>;
  onClose: () => void;
}) {
  useAmountsHidden();
  const [error, setError] = useState("");

  const remove = async () => {
    try {
      await api.delete(`/sales/${sale.id}`);
      await onDeleted();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo eliminar. Probá de nuevo."));
    }
  };

  // Con una sola línea o un solo medio, el título y la hora ya lo dijeron: no se repite.
  const [only] = sale.payments;
  return (
    <EntrySheet date={sale.sale_date} title={saleSummary(sale, products)} amount={formatARS(sale.total)} positive onClose={onClose}
      footer={
        <>
          {dayClosed && (
            <p className="px-1.5 pb-2.5 text-sm leading-snug text-[#4A4658]">
              Este día ya está cerrado y suma lo contado: si cambiás esta venta, revisá el cierre.
            </p>
          )}
          {error && <p role="alert" className="px-1.5 pb-2.5 text-sm text-destructive">{error}</p>}
          <SheetActions question="¿Eliminar esta venta? No se puede deshacer." keepLabel="No, dejarla" onEdit={onEdit} onDelete={remove} />
        </>
      }>
      <SheetRow label="Hora">{saleTime(sale)}</SheetRow>
      {sale.payments.length === 1
        ? <SheetRow label="Se cobró con">{PAYMENT_METHOD_LABELS[only.method]}</SheetRow>
        : sale.payments.map(p => (
            <SheetRow key={p.method} label={PAYMENT_METHOD_LABELS[p.method]}>
              <span className="tabular-nums">{formatARS(p.amount)}</span>
            </SheetRow>
          ))}
      {sale.lines.length > 1 && sale.lines.map(l => (
        <SheetRow key={l.id} label={`${Number(l.qty).toLocaleString("es-AR")} × ${lineName(l, products)}`}>
          {l.unit_price !== null && <span className="tabular-nums">{formatARS(Number(l.unit_price) * Number(l.qty))}</span>}
        </SheetRow>
      ))}
      {sale.notes && <SheetRow label="Nota">{sale.notes}</SheetRow>}
    </EntrySheet>
  );
}
