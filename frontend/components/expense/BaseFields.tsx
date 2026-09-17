"use client";

import { CurrencyToggle, DateField, FIELD, FormGrid, SelectField } from "@/components/ui/form";
import type { ExpenseDraft } from "./submit";

export interface CategoryOption { id: number; name: string; color?: string | null }

/**
 * Lo que tiene todo egreso: moneda, categoría, fecha, monto y descripción.
 *
 * Es el formulario que ya existía en /expenses, extraído tal cual para que el
 * formulario unificado lo reuse. Tres cosas cambian según el resto del borrador
 * y se reciben como props en vez de leerse acá: si la categoría se oculta
 * (dólares con tarjeta, la pone el backend), si el monto es "por cuota", y si
 * la descripción es obligatoria.
 */
export default function BaseFields({
  draft, set, categories, onNewCategory,
  hideCategory, amountLabel, descriptionRequired,
}: {
  draft: ExpenseDraft;
  set: (patch: Partial<ExpenseDraft>) => void;
  categories: CategoryOption[];
  onNewCategory: () => void;
  hideCategory: boolean;
  amountLabel: string;
  descriptionRequired: boolean;
}) {
  return (
    <>
      <CurrencyToggle className="mb-1" value={draft.currency} onChange={currency => set({ currency })} />
      <FormGrid>
        {hideCategory ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Categoría</label>
            <p className="mt-1 text-sm text-muted-foreground py-2">Se agrega a «Consumo en dólares».</p>
          </div>
        ) : (
          // Los egresos en dólares también llevan categoría: un viaje pagado en
          // dólares es "Viajes", no un balde de moneda. Sin elegir, cae en
          // "Consumo en dólares".
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Categoría
              {draft.currency === "USD" && (
                <span className="font-normal text-muted-foreground/80"> (opcional)</span>
              )}
            </label>
            <div className="flex gap-1.5">
              <SelectField className="flex-1"
                value={draft.category_id}
                onChange={category_id => set({ category_id })}
                placeholder={draft.currency === "USD" ? "Consumo en dólares" : "Categoría"}
                options={categories.map(c => ({ value: String(c.id), label: c.name }))} />
              <button type="button" title="Nueva categoría" onClick={onNewCategory}
                className="mt-1 px-2.5 border-2 border-ink rounded-lg text-muted-foreground hover:bg-accent shrink-0 text-lg leading-none">+</button>
            </div>
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Fecha</label>
          <DateField value={draft.expense_date} onChange={expense_date => set({ expense_date })} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">{amountLabel}</label>
          <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD} aria-label={amountLabel}
            value={draft.amount} onChange={e => set({ amount: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Descripción{!descriptionRequired && <span className="font-normal"> (opcional)</span>}
          </label>
          <input className={FIELD} aria-label="Descripción"
            value={draft.description} onChange={e => set({ description: e.target.value })} />
        </div>
      </FormGrid>
    </>
  );
}
