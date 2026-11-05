"use client";

import { useState } from "react";
import api from "@/lib/api";
import { formatARS, getErrorMessage, parseAmount } from "@/lib/utils";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import ProductTour from "@/components/ProductTour";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { closeFormSteps } from "@/components/business/tours";
import { ConfirmDelete } from "@/components/business/ui";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { FIELD } from "@/components/ui/form";
import { fromCents, toCents } from "@/lib/split";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type DaySummary, type PaymentMethod, type Product } from "@/lib/sales";

// Los que se muestran siempre, aunque el día no tenga ventas por ahí: la caja
// y la billetera son lo que se cuenta en cualquier mostrador.
const ALWAYS: PaymentMethod[] = ["efectivo", "mercadopago"];

const fmtInput = (n: number) => (n ? n.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "");

/**
 * El cierre del día: lo CONTADO por medio de pago.
 *
 * Arranca con lo que suman las ventas de cada medio, así contar es confirmar
 * o corregir. El día va a sumar lo contado; la diferencia con las ventas se
 * muestra ("sin ticket" si hay de más, "falta" si hay de menos) pero no se
 * guarda: un ticket olvidado que se carga después no puede sumar dos veces.
 */
export default function DailyCloseModal({ summary, title, products = [], onSaved, onClose }: {
  summary: DaySummary;
  /** "Cierre de hoy" / "Cierre del viernes 9 de octubre". */
  title: string;
  /** Para las unidades: sólo se preguntan las de los que llevan stock. */
  products?: Product[];
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  useAmountsHidden();
  const ticketed = Object.fromEntries(summary.by_method.map(m => [m.method, Number(m.ticketed)])) as Record<string, number>;
  const counted = Object.fromEntries(
    (summary.close?.payments ?? []).map(p => [p.method, Number(p.amount)]),
  ) as Record<string, number>;

  const initialMethods = PAYMENT_METHODS.filter(
    m => ALWAYS.includes(m) || ticketed[m] || counted[m],
  );
  const [methods, setMethods] = useState<PaymentMethod[]>(initialMethods);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialMethods.map(m => [m, fmtInput(summary.close ? counted[m] ?? 0 : ticketed[m] ?? 0)])),
  );
  const reaccionar = useReaccion();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Las unidades que salieron en el día, para el stock. Arrancan en lo que ya
  // dicen las ventas (o en lo del cierre anterior): el stock resta sólo lo que
  // falta, nunca dos veces (services/business/stock.sync_close_movements).
  const tracked = products.filter(p => p.is_active && p.track_stock);
  const soldUnits: Record<number, number> = {};
  for (const t of summary.tickets) {
    for (const l of t.lines) if (l.product_id) soldUnits[l.product_id] = (soldUnits[l.product_id] ?? 0) + Number(l.qty);
  }
  const closeUnits = Object.fromEntries(
    (summary.close?.lines ?? []).filter(l => l.product_id).map(l => [l.product_id as number, Number(l.qty)]),
  ) as Record<number, number>;
  const [units, setUnits] = useState<Record<number, string>>(() =>
    Object.fromEntries(tracked.map(p => [p.id, fmtInput(summary.close ? closeUnits[p.id] ?? 0 : soldUnits[p.id] ?? 0)])),
  );

  const totalCounted = fromCents(methods.reduce((s, m) => s + toCents(parseAmount(values[m] || "0")), 0));
  const hidden = PAYMENT_METHODS.filter(m => !methods.includes(m));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const counted = methods
      .map(m => ({ method: m, amount: parseAmount(values[m] || "0") }))
      .filter(p => p.amount > 0);
    if (!counted.length) { setError("Poné lo contado en al menos un medio."); return; }
    setSaving(true);
    setError(null);
    try {
      const unitRows = tracked
        .map(p => ({ product_id: p.id, qty: parseAmount(units[p.id] || "0") }))
        .filter(u => u.qty > 0);
      await api.put(`/sales/close/${summary.sale_date}`, { counted, units: unitRows });
      reaccionar("ingreso", "Cierre guardado");
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar el cierre."));
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api.delete(`/sales/close/${summary.sale_date}`);
      reaccionar("borrado", "Cierre borrado");
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo borrar el cierre."));
      setSaving(false);
    }
  };

  const amountInput = `${FIELD} !mt-0 !w-[132px] shrink-0 text-right tabular-nums`;
  return (
    <>
      <ProductTour tourId="close-form" steps={closeFormSteps({ hasUnits: tracked.length > 0 })} />
      <FormSheet title={title} onClose={onClose}>
        <form noValidate onSubmit={save} className={FORM_SHEET_FORM}>
          <div className={FORM_SHEET_BODY}>
            {/* El total se ve primero y grande, como el monto de cualquier formulario: acá sale de lo que se cuenta abajo. */}
            <div className="rounded-[22px] bg-white/70 border border-white/80 pl-4 pr-3 pt-2.5 pb-3">
              <p className="text-sm text-[#4A4658]">Total contado</p>
              <p className="tabular-nums text-[38px] font-medium leading-tight tracking-[-0.03em] text-foreground">{formatARS(totalCounted)}</p>
              <p className="mt-0.5 text-sm leading-snug text-[#4A4658]">Contá lo que hay por cada medio. El día va a sumar lo contado.</p>
            </div>

            <div className="rounded-[22px] bg-white/70 border border-white/80 px-3.5 divide-y divide-ink/[0.08]" data-tour="close-counted">
              {methods.map(m => {
                const sold = ticketed[m] ?? 0;
                const got = parseAmount(values[m] || "0");
                const diff = fromCents(toCents(got) - toCents(sold));
                return (
                  <div key={m} className="py-2.5" data-testid="close-row">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-foreground truncate">{PAYMENT_METHOD_LABELS[m]}</p>
                        {sold > 0 && <p className="text-[13px] text-muted-foreground tabular-nums">Vendido {formatARS(sold)}</p>}
                      </div>
                      <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={amountInput}
                        aria-label={`Contado en ${PAYMENT_METHOD_LABELS[m]}`} placeholder="0"
                        value={values[m] ?? ""} onChange={e => { setError(null); setValues(v => ({ ...v, [m]: e.target.value })); }} />
                    </div>
                    {diff !== 0 && (
                      <p className={`mt-1 text-[13px] text-right tabular-nums ${diff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {diff > 0 ? `${formatARS(diff)} sin ticket` : `Falta ${formatARS(-diff)}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {hidden.length > 0 && (
              <div className="flex flex-wrap gap-x-3 px-1.5">
                {hidden.map(m => (
                  <button key={m} type="button" className="min-h-[44px] text-[15px] font-semibold text-[#3B2FB3]"
                    onClick={() => { setMethods(ms => PAYMENT_METHODS.filter(x => ms.includes(x) || x === m)); setValues(v => ({ ...v, [m]: "" })); }}>
                    + {PAYMENT_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            )}

            {tracked.length > 0 && (
              <div data-tour="close-units">
                <p className="px-1.5 pb-1.5 text-sm text-[#4A4658]">Unidades que salieron en el día, para el stock</p>
                <div className="rounded-[22px] bg-white/70 border border-white/80 px-3.5 divide-y divide-ink/[0.08]">
                  {tracked.map(p => (
                    <div key={p.id} className="flex items-center gap-3 py-2" data-testid="close-unit">
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-medium text-foreground truncate">{p.name}</p>
                        {!!soldUnits[p.id] && (
                          <p className="text-[13px] text-muted-foreground">En ventas: {soldUnits[p.id].toLocaleString("es-AR")}</p>
                        )}
                      </div>
                      <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={`${FIELD} !mt-0 !w-24 shrink-0 text-right tabular-nums`}
                        aria-label={`Unidades de ${p.name}`} placeholder="0"
                        value={units[p.id] ?? ""} onChange={e => setUnits(u => ({ ...u, [p.id]: e.target.value }))} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.close && (
              <ConfirmDelete label="Borrar cierre" disabled={saving} onConfirm={remove}
                question="¿Borrar el cierre? El día va a volver a sumar sólo las ventas cargadas." />
            )}
          </div>

          {error && <p role="alert" className="mx-3.5 mb-1 text-sm text-destructive">{error}</p>}
          <FormSheetActions onCancel={onClose} saving={saving} data-tour="close-save"
            label={summary.close ? "Guardar cierre" : "Cerrar el día"} />
        </form>
      </FormSheet>
    </>
  );
}
