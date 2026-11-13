"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Check, Repeat } from "lucide-react";
import api from "@/lib/api";
import { formatARS, formatUSD, getErrorMessage, parseAmount } from "@/lib/utils";
import { FIELD } from "@/components/ui/form";
import { Chip } from "@/components/ui/chip";
import { useReaccion } from "@/components/brand/ToodReaccion";

/**
 * Un gasto recurrente en su ficha (Egresos o el resumen de una tarjeta).
 *
 * Un mes "a confirmar" ya suma, y se resuelve acá: confirmar como vino,
 * confirmar con otro monto, o "este mes no", que pregunta enseguida qué pasa
 * con el siguiente: sin confirmar no aparece el próximo, así que saltear sin
 * decidir dejaría la serie viva sin mes siguiente. No vence: pasada su fecha se
 * confirma igual, y lo único que cambia es el aviso.
 *
 * Las reglas están en `backend/app/services/recurrences.py`; esto sólo llama.
 */

export type RecurrenceStatus = "pending" | "confirmed";

/** El chip de la fila. Punteado, como lo estimado: es una sugerencia que ya suma. */
export function PendingChip() {
  return <Chip locked className="px-2 py-0 text-[11px] shrink-0">a confirmar</Chip>;
}

const asTyped = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayMonth = (iso: string) => format(parseISO(iso), "d 'de' MMMM", { locale: es });
const todayIso = () => format(new Date(), "yyyy-MM-dd");

const SECONDARY = "h-12 rounded-full bg-white/70 border border-white/80 font-semibold text-[15px] text-foreground active:scale-[0.98] transition-transform duration-100 disabled:opacity-50";
const PRIMARY = "h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform duration-100 disabled:opacity-50";

export function RecurrencePanel({ entryId, recurrenceId, status, amount, currency, date, onChanged }: {
  /** El gasto de ese mes (el espejo, si es de tarjeta). */
  entryId: number;
  recurrenceId: number;
  status: RecurrenceStatus;
  amount: number;
  currency?: string | null;
  date: string;
  /** Después de cualquier acción: cerrar la ficha y recargar. */
  onChanged: () => void;
}) {
  const reaccionar = useReaccion();
  const [mode, setMode] = useState<"idle" | "amount" | "skip" | "end">("idle");
  const [value, setValue] = useState(asTyped(Number(amount)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usd = currency === "USD";
  const money = (n: number) => (usd ? formatUSD(n) : formatARS(n));

  const run = async (call: () => Promise<unknown>, done: string, kind: "guardado" | "borrado" = "guardado") => {
    setBusy(true);
    setError(null);
    try {
      await call();
      reaccionar(kind, done);
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar."));
      reaccionar("error", "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  const confirm = (newAmount?: number) => run(
    () => api.post(`/recurrences/entries/${entryId}/confirm`, newAmount === undefined ? {} : { amount: newAmount }),
    "Confirmado",
  );
  const skip = (keep_going: boolean) => run(
    () => api.post(`/recurrences/entries/${entryId}/skip`, { keep_going }),
    keep_going ? "Este mes no va" : "Dado de baja",
    "borrado",
  );
  const end = () => run(() => api.post(`/recurrences/${recurrenceId}/end`), "Dado de baja", "borrado");

  if (status === "confirmed") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1.5 text-sm text-[#4A4658]">
          <Repeat className="w-4 h-4 shrink-0" />
          <span className="flex-1">Se repite todos los meses.</span>
          {mode !== "end" && (
            <button type="button" onClick={() => setMode("end")}
              className="min-h-[44px] px-2 font-semibold text-destructive">
              Dar de baja
            </button>
          )}
        </div>
        {mode === "end" && (
          <div className="rounded-[22px] bg-rose-50 border border-rose-200 p-2.5" role="alert">
            <p className="px-1.5 pb-2 text-[15px] font-medium text-rose-900">
              ¿Darlo de baja? No vuelve a aparecer, y el mes que está a confirmar se borra.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" autoFocus onClick={() => setMode("idle")} disabled={busy}
                className="h-12 rounded-full bg-white border border-rose-200 font-semibold text-[15px] text-foreground">
                No, dejarlo
              </button>
              <button type="button" onClick={end} disabled={busy}
                className="h-12 rounded-full bg-destructive text-destructive-foreground font-semibold text-[15px]">
                Sí, dar de baja
              </button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="px-1.5 text-xs text-rose-700">{error}</p>}
      </div>
    );
  }

  const overdue = date < todayIso();
  return (
    <div className="rounded-[22px] bg-accent border border-[#CFC9E4] p-2.5 space-y-2.5">
      <div className="px-1.5 pt-0.5">
        <p className="flex items-center gap-1.5 font-semibold text-[15px] text-foreground">
          <Repeat className="w-4 h-4 shrink-0 text-[#3B2FB3]" /> Recurrente, a confirmar
        </p>
        <p className="mt-0.5 text-sm leading-snug text-[#3F3B4B]">
          {overdue
            ? `Era el ${dayMonth(date)}. Ya suma en el mes: fijate cuánto vino y confirmalo.`
            : `Viene el ${dayMonth(date)}. Ya suma en el mes: cuando llegue, fijate cuánto vino y confirmalo.`}
        </p>
      </div>

      {mode === "idle" && (
        <>
          <button type="button" onClick={() => confirm()} disabled={busy} className={`w-full ${PRIMARY}`}>
            <Check className="w-4 h-4" /> Confirmar {money(Number(amount))}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode("amount")} disabled={busy} className={SECONDARY}>
              Cambió el monto
            </button>
            <button type="button" onClick={() => setMode("skip")} disabled={busy} className={SECONDARY}>
              Este mes no
            </button>
          </div>
        </>
      )}

      {mode === "amount" && (
        <form className="space-y-2" onSubmit={e => {
          e.preventDefault();
          const n = parseAmount(value);
          if (!(n > 0)) { setError("Poné un monto mayor a cero."); return; }
          confirm(n);
        }}>
          <label className="block px-1.5 text-xs font-medium text-muted-foreground" htmlFor={`rec-amount-${entryId}`}>
            ¿Cuánto vino este mes?
          </label>
          <div className="flex items-center gap-2">
            <span className="pl-1.5 tabular-nums text-muted-foreground">{usd ? "U$D" : "$"}</span>
            <input id={`rec-amount-${entryId}`} autoFocus type="text" inputMode="decimal" pattern="[0-9.,]*"
              className={`${FIELD} tabular-nums`} value={value} onChange={e => { setError(null); setValue(e.target.value); }} />
          </div>
          <p className="px-1.5 text-xs text-[#3F3B4B]">Desde ahora es el monto de los meses que siguen.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode("idle")} disabled={busy} className={SECONDARY}>Volver</button>
            <button type="submit" disabled={busy} className={PRIMARY}>Confirmar</button>
          </div>
        </form>
      )}

      {mode === "skip" && (
        <div className="space-y-2">
          <p className="px-1.5 text-[15px] font-medium text-foreground">Este mes no va. ¿Y el mes que sigue?</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => skip(true)} disabled={busy} className={SECONDARY}>
              Sigue
            </button>
            <button type="button" onClick={() => skip(false)} disabled={busy}
              className="h-12 rounded-full bg-white border border-rose-200 font-semibold text-[15px] text-destructive disabled:opacity-50">
              Darlo de baja
            </button>
          </div>
          <button type="button" onClick={() => setMode("idle")} disabled={busy}
            className="w-full min-h-[44px] text-sm font-semibold text-[#3F3B4B]">
            Volver
          </button>
        </div>
      )}

      {error && <p role="alert" className="px-1.5 text-xs text-rose-700">{error}</p>}
    </div>
  );
}
