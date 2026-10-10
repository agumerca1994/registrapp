"use client";

import { useState } from "react";
import { X } from "lucide-react";
import api from "@/lib/api";
import { formatARS, getErrorMessage, parseAmount } from "@/lib/utils";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/components/ui/form";
import { fromCents, toCents } from "@/lib/split";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type DaySummary, type PaymentMethod } from "@/lib/sales";

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
export default function DailyCloseModal({ summary, title, onSaved, onClose }: {
  summary: DaySummary;
  /** "Cierre de hoy" / "Cierre del viernes 9 de octubre". */
  title: string;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await api.put(`/sales/close/${summary.sale_date}`, { counted });
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar el cierre."));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("¿Borrar el cierre? El día va a volver a sumar sólo las ventas cargadas.")) return;
    setSaving(true);
    try {
      await api.delete(`/sales/close/${summary.sale_date}`);
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo borrar el cierre."));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-foreground first-letter:uppercase">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Contá lo que hay por cada medio. El día va a sumar lo contado.
        </p>

        <form noValidate onSubmit={save} className="space-y-3">
          {methods.map(m => {
            const sold = ticketed[m] ?? 0;
            const got = parseAmount(values[m] || "0");
            const diff = fromCents(toCents(got) - toCents(sold));
            return (
              <div key={m} data-testid="close-row">
                <div className="flex items-baseline justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground">{PAYMENT_METHOD_LABELS[m]}</label>
                  <span className="text-[11px] text-muted-foreground tabular-nums">vendido {formatARS(sold)}</span>
                </div>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD}
                  aria-label={`Contado en ${PAYMENT_METHOD_LABELS[m]}`} placeholder="0"
                  value={values[m] ?? ""} onChange={e => { setError(null); setValues(v => ({ ...v, [m]: e.target.value })); }} />
                {diff !== 0 && (
                  <p className={`text-[11px] mt-1 tabular-nums ${diff < 0 ? "text-rose-700" : "text-muted-foreground"}`}>
                    {diff > 0 ? `${formatARS(diff)} sin ticket` : `Falta ${formatARS(-diff)}`}
                  </p>
                )}
              </div>
            );
          })}

          {hidden.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {hidden.map(m => (
                <button key={m} type="button" className="text-primary font-medium hover:underline"
                  onClick={() => { setMethods(ms => PAYMENT_METHODS.filter(x => ms.includes(x) || x === m)); setValues(v => ({ ...v, [m]: "" })); }}>
                  + {PAYMENT_METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm font-semibold text-foreground">Total contado</span>
            <span className="text-base font-bold tabular-nums">{formatARS(totalCounted)}</span>
          </div>

          {error && <p role="alert" className="text-xs text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            {summary.close && (
              <Button type="button" variant="ghost" className="text-destructive mr-auto" disabled={saving} onClick={remove}>
                Borrar cierre
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Cerrar el día"}</Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
