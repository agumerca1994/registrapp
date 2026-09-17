"use client";

import Link from "next/link";
import { FIELD, FieldLabel, MonthField, SegmentedToggle, SelectField } from "@/components/ui/form";
import { formatARS, formatUSD } from "@/lib/utils";
import {
  MAX_INSTALLMENTS, cardLabel, installmentCount, purchaseTotal, shareBase,
  type CreditCardLite, type ExpenseDraft,
} from "./submit";

export type CardsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; cards: CreditCardLite[] };

/**
 * Tarjeta, mes del resumen y en un pago o en cuotas.
 *
 * Dos cosas que la pantalla tiene que decir en vez de esconder:
 *
 * - **RegistrApp no calcula el cierre.** No sabe en qué día cierra cada
 *   tarjeta, así que el mes lo propone por la fecha del gasto y la persona lo
 *   corrige. Presentarlo como un cálculo haría pasar un gasto al mes
 *   equivocado sin que nadie lo note.
 * - **En dólares, sólo en un pago.** La opción "En cuotas" se ve apagada con el
 *   motivo, en vez de desaparecer al tocar U$D.
 */
export default function CardPaymentSection({ draft, set, cardsState, onRetry }: {
  draft: ExpenseDraft;
  set: (patch: Partial<ExpenseDraft>) => void;
  cardsState: CardsState;
  onRetry: () => void;
}) {
  const money = draft.currency === "USD" ? formatUSD : formatARS;

  if (cardsState.status === "loading") {
    return <p className="text-xs text-muted-foreground">Cargando tus tarjetas…</p>;
  }
  if (cardsState.status === "error") {
    return (
      <div className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground flex items-center justify-between gap-2">
        No pudimos cargar tus tarjetas.
        <button type="button" onClick={onRetry} className="font-medium text-foreground underline">Reintentar</button>
      </div>
    );
  }
  if (cardsState.cards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground space-y-1">
        <p>Todavía no cargaste ninguna tarjeta.</p>
        <p>
          <Link href="/tarjetas" className="font-medium text-foreground underline">Cargar una tarjeta</Link>
          {" "}(lo que escribiste acá no se guarda).
        </p>
      </div>
    );
  }

  const usd = draft.currency === "USD";
  const n = installmentCount(draft);

  return (
    <div className="space-y-3 rounded-lg border border-border px-3 py-3">
      <div>
        <FieldLabel>Tarjeta</FieldLabel>
        <SelectField
          value={draft.card_id}
          onChange={card_id => set({ card_id })}
          placeholder="Elegí la tarjeta"
          options={cardsState.cards.map(c => ({ value: String(c.id), label: cardLabel(c) }))}
        />
      </div>

      <div>
        <FieldLabel>Resumen de</FieldLabel>
        <MonthField
          value={draft.period}
          min={draft.expense_date ? draft.expense_date.slice(0, 7) : undefined}
          onChange={period => set({ period, periodTouched: true })}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          RegistrApp no calcula el cierre de tu tarjeta. Si compraste después del cierre, elegí el mes siguiente.
        </p>
      </div>

      <div className="space-y-1.5">
        <SegmentedToggle
          ariaLabel="Forma de pago con tarjeta"
          value={draft.plan}
          onChange={plan => set({ plan })}
          options={[
            { value: "single", label: "En un pago" },
            { value: "installment", label: "En cuotas", disabled: usd },
          ]}
        />
        {usd && <p className="text-[11px] text-muted-foreground">En dólares, sólo en un pago.</p>}
      </div>

      {draft.plan === "installment" && !usd && (
        <div>
          <FieldLabel>Cantidad de cuotas</FieldLabel>
          <input type="text" inputMode="numeric" pattern="[0-9]*" className={FIELD} aria-label="Cantidad de cuotas"
            placeholder="3" maxLength={String(MAX_INSTALLMENTS).length}
            value={draft.installments} onChange={e => set({ installments: e.target.value.replace(/\D/g, "") })} />
          {n >= 2 && shareBase(draft) > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Total de la compra: {n} × {money(shareBase(draft))} = {money(purchaseTotal(draft))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
