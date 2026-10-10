"use client";

import { useState } from "react";
import { Minus, Plus, Trash2, X } from "lucide-react";
import api from "@/lib/api";
import { formatARS, getErrorMessage } from "@/lib/utils";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { FIELD, FieldLabel } from "@/components/ui/form";
import {
  PAYMENT_METHOD_LABELS, PAYMENT_METHODS, buildSaleBody, chargedTotal, linesTotal, newLineKey,
  newSaleDraft, validateSale, type PaymentMethod, type Product, type Sale, type SaleDraft,
} from "@/lib/sales";

const METHOD_OPTIONS = PAYMENT_METHODS.map(m => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));

function priceText(p: Product): string {
  return p.sale_price === null || p.sale_price === "" ? "" :
    Number(p.sale_price).toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

/**
 * Cargar una venta en el mostrador: tocar productos, ajustar cantidades y
 * cobrar. Pensado para hacerse rápido con una mano.
 *
 * - Sin productos cargados igual se puede vender: "venta rápida" con el total.
 * - El total sigue a las líneas hasta que se toca (un descuento, un redondeo):
 *   lo cobrado es la verdad de la plata.
 * - El botón queda deshabilitado mientras guarda y la venta lleva un
 *   `client_ref`: un doble toque o un reintento no la cargan dos veces.
 * - Un error deja el formulario abierto con todo lo cargado.
 */
export default function SaleFormModal({ sale, initial, saleDate, products, onSaved, onDeleted, onClose }: {
  /** Editando: la venta guardada. */
  sale?: Sale;
  initial?: SaleDraft;
  saleDate: string;
  products: Product[];
  onSaved: () => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
  onClose: () => void;
}) {
  useAmountsHidden();
  const editing = !!sale;
  const [draft, setDraft] = useState<SaleDraft>(() => initial ?? newSaleDraft(saleDate));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<SaleDraft>) => { setError(null); setDraft(d => ({ ...d, ...patch })); };

  const addProduct = (p: Product) => {
    const existing = draft.lines.find(l => l.product_id === p.id);
    set({
      lines: existing
        ? draft.lines.map(l => (l === existing ? { ...l, qty: l.qty + 1 } : l))
        : [...draft.lines, { key: newLineKey(), product_id: p.id, description: "", qty: 1, unit_price: priceText(p) }],
    });
  };
  const changeQty = (key: string, delta: number) =>
    set({
      lines: draft.lines
        .map(l => (l.key === key ? { ...l, qty: Math.max(0, l.qty + delta) } : l))
        .filter(l => l.qty > 0),
    });
  const updateLine = (key: string, patch: Partial<SaleDraft["lines"][number]>) =>
    set({ lines: draft.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) });

  const total = chargedTotal(draft);
  const fromLines = linesTotal(draft);
  const active = products.filter(p => p.is_active);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const problem = validateSale(draft);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError(null);
    try {
      const body = buildSaleBody(draft);
      if (editing) await api.patch(`/sales/${sale!.id}`, body);
      else await api.post("/sales", body);
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar la venta."));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!sale || !confirm("¿Eliminar esta venta?")) return;
    setSaving(true);
    try {
      await api.delete(`/sales/${sale.id}`);
      await onDeleted?.();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo eliminar."));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-5 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">{editing ? "Editar venta" : "Nueva venta"}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form noValidate onSubmit={submit} className="space-y-4">
          {active.length > 0 ? (
            <div className="space-y-2">
              <FieldLabel>Productos</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {active.map(p => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)}
                    className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-card px-3 py-1.5 text-sm font-medium shadow-chip hover:bg-accent active:translate-y-px">
                    <Plus className="w-3.5 h-3.5 text-primary" />
                    {p.name}
                    {p.sale_price !== null && p.sale_price !== "" && (
                      <span className="text-muted-foreground font-normal">{formatARS(p.sale_price)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Cargá tus productos en <span className="font-medium">Productos</span> para venderlos con un toque.
              Mientras tanto, poné el total cobrado.
            </p>
          )}

          {draft.lines.length > 0 && (
            <div className="rounded-xl border divide-y">
              {draft.lines.map(l => {
                const product = l.product_id ? products.find(p => p.id === l.product_id) : null;
                return (
                  <div key={l.key} className="flex items-center gap-2 px-3 py-2" data-testid="sale-line">
                    <div className="min-w-0 flex-1">
                      {product ? (
                        <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
                      ) : (
                        <input className={`${FIELD} mt-0 py-1.5`} placeholder="Qué se vendió" aria-label="Descripción"
                          value={l.description} onChange={e => updateLine(l.key, { description: e.target.value })} />
                      )}
                      <input type="text" inputMode="decimal" pattern="[0-9.,]*"
                        className="mt-1 w-28 text-xs text-muted-foreground bg-transparent border-b border-dashed outline-none focus:border-ink"
                        placeholder="Precio unitario" aria-label="Precio unitario"
                        value={l.unit_price} onChange={e => updateLine(l.key, { unit_price: e.target.value })} />
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => changeQty(l.key, -1)} aria-label="Uno menos"
                        className="p-1.5 rounded-lg border hover:bg-accent">
                        {l.qty <= 1 ? <Trash2 className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                      </button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums" aria-label="Cantidad">{l.qty}</span>
                      <button type="button" onClick={() => changeQty(l.key, 1)} aria-label="Uno más"
                        className="p-1.5 rounded-lg border hover:bg-accent">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button type="button"
            onClick={() => set({ lines: [...draft.lines, { key: newLineKey(), product_id: null, description: "", qty: 1, unit_price: "" }] })}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-dashed text-sm text-muted-foreground hover:bg-accent">
            <Plus className="w-4 h-4" /> Otra cosa
          </button>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Total cobrado</label>
            <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD} aria-label="Total cobrado"
              placeholder="0"
              value={draft.totalTouched ? draft.total : (fromLines ? fromLines.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "")}
              onChange={e => set({ total: e.target.value, totalTouched: e.target.value.trim() !== "" })} />
            {draft.totalTouched && fromLines > 0 && Math.round(fromLines * 100) !== Math.round(total * 100) && (
              <p className="text-xs text-muted-foreground mt-1">Los productos suman {formatARS(fromLines)}.</p>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel>{draft.split ? "Primer medio de pago" : "Cómo se cobró"}</FieldLabel>
            <ChoiceChips ariaLabel="Medio de pago" value={draft.method}
              onChange={m => set({ method: m as PaymentMethod })} options={METHOD_OPTIONS} />
            {draft.split ? (
              <div className="rounded-xl border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <FieldLabel>Segundo medio</FieldLabel>
                  <button type="button" onClick={() => set({ split: null })} className="text-xs text-muted-foreground hover:text-foreground">
                    Quitar
                  </button>
                </div>
                <ChoiceChips ariaLabel="Segundo medio de pago" value={draft.split.method}
                  onChange={m => set({ split: { ...draft.split!, method: m as PaymentMethod } })}
                  options={METHOD_OPTIONS.filter(o => o.value !== draft.method)} />
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD}
                  aria-label="Monto del segundo medio" placeholder="Cuánto por este medio"
                  value={draft.split.amount} onChange={e => set({ split: { ...draft.split!, amount: e.target.value } })} />
              </div>
            ) : (
              <button type="button"
                onClick={() => set({ split: { method: draft.method === "efectivo" ? "mercadopago" : "efectivo", amount: "" } })}
                className="text-xs font-medium text-primary hover:underline">
                Dividir el pago
              </button>
            )}
          </div>

          {error && <p role="alert" className="text-xs text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            {editing && (
              <Button type="button" variant="ghost" className="text-destructive mr-auto" disabled={saving} onClick={remove}>
                Eliminar
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando..." : total > 0 ? `Cobrar ${formatARS(total)}` : "Guardar"}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
