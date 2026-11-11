"use client";

import { useState } from "react";
import api from "@/lib/api";
import { getErrorMessage, parseAmount } from "@/lib/utils";
import { DateField, FIELD, FieldLabel, FormGrid, SelectField } from "@/components/ui/form";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { businessToday, type Product } from "@/lib/sales";

export type StockAction = "produccion" | "conteo" | "merma" | "compra";

const COPY: Record<StockAction, { title: string; qty: string; help: string }> = {
  produccion: { title: "Cargar producción", qty: "Cuántas hiciste", help: "Suma al stock: lo que salió de la cocina." },
  conteo: { title: "Contar stock", qty: "Cuántas quedan", help: "Lo que hay ahora. La diferencia con lo que figuraba queda como ajuste." },
  merma: { title: "Cargar merma", qty: "Cuántas se perdieron", help: "Resta del stock: lo que se tiró, se rompió o venció." },
  compra: { title: "Ingreso de mercadería", qty: "Cuántas entraron", help: "Para lo comprado con tarjeta o sin cargar el gasto: suma al stock." },
};

/**
 * Un movimiento de stock a mano: producción ("hice 30 empanadas"), conteo
 * ("quedan 5"), merma o ingreso. Las compras con gasto y las ventas mueven el
 * stock solas; esto es lo que no pasa por ninguna de las dos.
 */
export function StockMovementModal({ action, products, productId, onSaved, onClose }: {
  action: StockAction;
  products: Product[];
  productId?: number;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const copy = COPY[action];
  const [product, setProduct] = useState(productId ? String(productId) : "");
  const [qty, setQty] = useState("");
  const [day, setDay] = useState(businessToday());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseAmount(qty || "0");
    if (!product) { setError("Elegí el producto."); return; }
    if (action === "conteo" ? amount < 0 || qty.trim() === "" : !(amount > 0)) {
      setError(action === "conteo" ? "Poné cuántas quedan (puede ser 0)." : "Poné una cantidad mayor a cero.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (action === "conteo") {
        await api.post("/stock/counts", { movement_date: day, counts: [{ product_id: Number(product), counted_qty: amount }] });
      } else {
        await api.post("/stock/movements", {
          product_id: Number(product), kind: action, qty: amount, movement_date: day, notes: notes.trim() || null,
        });
      }
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar"));
      setSaving(false);
    }
  };

  return (
    <FormSheet title={copy.title} onClose={onClose}>
      <form noValidate onSubmit={save} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <p className="px-1.5 text-sm leading-snug text-[#4A4658]">{copy.help}</p>
          <div>
            <FieldLabel>Producto</FieldLabel>
            <SelectField value={product} onChange={setProduct} placeholder="Elegí un producto"
              options={products.filter(p => p.is_active).map(p => ({ value: String(p.id), label: p.name }))} />
          </div>
          <FormGrid>
            <div>
              <FieldLabel>{copy.qty}</FieldLabel>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD} aria-label={copy.qty}
                autoFocus value={qty} onChange={e => setQty(e.target.value)} />
            </div>
            <div>
              <FieldLabel>Fecha</FieldLabel>
              <DateField value={day} onChange={setDay} />
            </div>
          </FormGrid>
          {action !== "conteo" && (
            <div>
              <FieldLabel hint="(opcional)">Nota</FieldLabel>
              <input className={FIELD} maxLength={255} aria-label="Nota" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder={action === "merma" ? "Se quemaron en el horno" : ""} />
            </div>
          )}
        </div>
        {error && <p role="alert" className="mx-3.5 mb-1 text-sm text-destructive">{error}</p>}
        <FormSheetActions onCancel={onClose} saving={saving} label="Guardar" />
      </form>
    </FormSheet>
  );
}
