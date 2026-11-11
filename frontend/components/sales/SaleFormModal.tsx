"use client";

import { useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { formatARS, getErrorMessage } from "@/lib/utils";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { ChoiceChips } from "@/components/ui/choice-chips";
import ProductTour from "@/components/ProductTour";
import { saleFormSteps } from "@/components/business/tours";
import { FIELD, FieldLabel } from "@/components/ui/form";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
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
 *
 * Eliminar una venta está en su ficha (`SaleSheet`).
 */
export default function SaleFormModal({ sale, initial, saleDate, products, onSaved, onClose }: {
  /** Editando: la venta guardada. */
  sale?: Sale;
  initial?: SaleDraft;
  saleDate: string;
  products: Product[];
  onSaved: () => void | Promise<void>;
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
  const stepper = "w-10 h-10 rounded-full bg-ink/[0.07] text-foreground flex items-center justify-center active:scale-[0.95] transition-transform duration-100";

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

  return (
    <>
      <FormSheet title={editing ? "Editar venta" : "Nueva venta"} onClose={onClose}>
        {/* Adentro de la hoja: corre en su capa, no en la de la página. */}
        <ProductTour tourId="sale-form" steps={saleFormSteps({ hasProducts: active.length > 0 })} />
        <form noValidate onSubmit={submit} className={FORM_SHEET_FORM}>
          <div className={FORM_SHEET_BODY}>
            <div data-tour="sale-total">
              <AmountField label="Total cobrado" currency="ARS"
                value={draft.totalTouched ? draft.total : (fromLines ? fromLines.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "")}
                onChange={e => set({ total: e.target.value, totalTouched: e.target.value.trim() !== "" })}
                footer={draft.totalTouched && fromLines > 0 && Math.round(fromLines * 100) !== Math.round(total * 100)
                  ? <p className="mt-1 text-sm text-[#4A4658]">Los productos suman {formatARS(fromLines)}.</p>
                  : undefined} />
            </div>

            {active.length > 0 ? (
              // Alto fijo: un catálogo largo no puede empujar cómo se cobró fuera de la hoja.
              <div className="flex flex-wrap gap-2 max-h-[156px] overflow-y-auto p-0.5" data-tour="sale-products">
                {active.map(p => {
                  const inSale = draft.lines.some(l => l.product_id === p.id);
                  return (
                    <button key={p.id} type="button" onClick={() => addProduct(p)}
                      className={`inline-flex items-center gap-1.5 min-h-[44px] rounded-full border px-3.5 py-1.5 text-sm font-medium text-left active:scale-[0.97] transition-transform duration-100 ${inSale ? "bg-accent border-[#CFC9E4]" : "bg-card border-border"}`}>
                      {p.name}
                      {p.sale_price !== null && p.sale_price !== "" && (
                        <span className="font-normal text-muted-foreground tabular-nums whitespace-nowrap">{formatARS(p.sale_price).replace(/,00$/, "")}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="px-1.5 text-sm leading-snug text-[#4A4658]">
                Cargá tus productos en Productos para venderlos con un toque. Mientras tanto, poné el total cobrado.
              </p>
            )}

            {draft.lines.length > 0 && (
              <div className="rounded-[22px] bg-white/70 border border-white/80 px-3.5 divide-y divide-ink/[0.08]">
                {draft.lines.map(l => {
                  const product = l.product_id ? products.find(p => p.id === l.product_id) : null;
                  return (
                    <div key={l.key} className="flex items-center gap-2 py-2" data-testid="sale-line">
                      <div className="min-w-0 flex-1">
                        {product ? (
                          <p className="text-[15px] font-semibold text-foreground truncate">{product.name}</p>
                        ) : (
                          <input className={`${FIELD} !mt-0 !py-1.5`} placeholder="Qué se vendió" aria-label="Descripción"
                            value={l.description} onChange={e => updateLine(l.key, { description: e.target.value })} />
                        )}
                        <label className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
                          $
                          <input type="text" inputMode="decimal" pattern="[0-9.,]*"
                            className="w-24 tabular-nums bg-transparent text-muted-foreground border-b border-ink/15 outline-none focus:border-primary"
                            placeholder="Precio" aria-label="Precio unitario"
                            value={l.unit_price} onChange={e => updateLine(l.key, { unit_price: e.target.value })} />
                        </label>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => changeQty(l.key, -1)} aria-label={l.qty <= 1 ? "Quitar" : "Uno menos"} className={stepper}>
                          {l.qty <= 1 ? <Trash2 className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                        </button>
                        <span className="w-7 text-center text-[17px] font-medium tabular-nums" aria-label="Cantidad">{l.qty}</span>
                        <button type="button" onClick={() => changeQty(l.key, 1)} aria-label="Uno más" className={stepper}>
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button type="button"
              onClick={() => set({ lines: [...draft.lines, { key: newLineKey(), product_id: null, description: "", qty: 1, unit_price: "" }] })}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-1.5 text-[15px] font-semibold text-[#3B2FB3]">
              <Plus className="w-4 h-4" /> Otra cosa
            </button>

            <div className="space-y-1.5" data-tour="sale-method">
              <FieldLabel>{draft.split ? "Primer medio de pago" : "Cómo se cobró"}</FieldLabel>
              <ChoiceChips ariaLabel="Medio de pago" value={draft.method} wrap
                onChange={m => set({ method: m as PaymentMethod })} options={METHOD_OPTIONS} />
              {draft.split ? (
                <div className="rounded-[22px] bg-white/70 border border-white/80 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <FieldLabel>Segundo medio</FieldLabel>
                    <button type="button" onClick={() => set({ split: null })} className="min-h-[36px] px-1.5 text-sm font-semibold text-muted-foreground">
                      Quitar
                    </button>
                  </div>
                  <ChoiceChips ariaLabel="Segundo medio de pago" value={draft.split.method} wrap
                    onChange={m => set({ split: { ...draft.split!, method: m as PaymentMethod } })}
                    options={METHOD_OPTIONS.filter(o => o.value !== draft.method)} />
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD}
                    aria-label="Monto del segundo medio" placeholder="Cuánto por este medio"
                    value={draft.split.amount} onChange={e => set({ split: { ...draft.split!, amount: e.target.value } })} />
                </div>
              ) : (
                <button type="button"
                  onClick={() => set({ split: { method: draft.method === "efectivo" ? "mercadopago" : "efectivo", amount: "" } })}
                  className="min-h-[44px] px-1.5 text-[15px] font-semibold text-[#3B2FB3]">
                  Dividir el pago
                </button>
              )}
            </div>
          </div>

          {error && <p role="alert" className="mx-3.5 mb-1 text-sm text-destructive">{error}</p>}
          <FormSheetActions onCancel={onClose} saving={saving} data-tour="sale-save"
            label={total > 0 ? `Cobrar ${formatARS(total).replace(/,00$/, "")}` : "Guardar"} />
        </form>
      </FormSheet>
    </>
  );
}
