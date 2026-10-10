"use client";

import { useState } from "react";
import { X } from "lucide-react";
import api from "@/lib/api";
import { getErrorMessage, parseAmount } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateField, FIELD, FormGrid, SelectField } from "@/components/ui/form";
import { businessToday, type Product } from "@/lib/sales";

export type StockAction = "produccion" | "conteo" | "merma" | "compra";

const COPY: Record<StockAction, { title: string; qty: string; help: string }> = {
  produccion: { title: "Cargar producción", qty: "Cuántas hiciste", help: "Suma al stock: lo que salió de la cocina." },
  conteo: { title: "Contar stock", qty: "Cuántas quedan", help: "Lo que hay ahora. La diferencia con el libro queda como ajuste." },
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
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">{copy.title}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">{copy.help}</p>
        <form noValidate onSubmit={save} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Producto</label>
            <SelectField value={product} onChange={setProduct} placeholder="Elegí un producto"
              options={products.filter(p => p.is_active).map(p => ({ value: String(p.id), label: p.name }))} />
          </div>
          <FormGrid>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{copy.qty}</label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD} aria-label={copy.qty}
                autoFocus value={qty} onChange={e => setQty(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha</label>
              <DateField value={day} onChange={setDay} />
            </div>
          </FormGrid>
          {action !== "conteo" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nota (opcional)</label>
              <input className={FIELD} maxLength={255} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder={action === "merma" ? "Se quemaron en el horno" : ""} />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
