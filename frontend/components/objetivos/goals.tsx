"use client";

import { useState } from "react";
import { endOfMonth, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { getErrorMessage, parseAmount } from "@/lib/utils";
import { ledgerAmount } from "@/components/movimientos/Ledger";
import ProductTour from "@/components/ProductTour";
import type { Step } from "react-joyride";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { DateField, FIELD, MonthField, SegmentedToggle } from "@/components/ui/form";

export type Currency = "USD" | "ARS";

export interface Goal {
  id: number;
  name: string;
  currency: Currency;
  target_amount: string;
  target_date: string | null;
  archived: boolean;
  created_at: string;
  saved: string;
  remaining: string;
  pct: number;
  achieved: boolean;
  months_left: number | null;
  per_month_needed: string | null;
  pace_per_month: string | null;
  // Cuota fija mensual: sin `plan_amount`, aportes sueltos.
  plan_amount: string | null;
  plan_day: number | null;
  plan_paused: boolean;
  plan_paid_this_month: boolean;
  plan_due: boolean;          // toca cumplirla este mes y todavía no se aportó
  plan_due_amount: string | null;
  plan_eta: string | null;    // a ese ritmo, el mes en que se llega
  eta: string | null;
  overdue: boolean;
  last_contribution: string | null;
}

export interface GoalsResponse {
  goals: Goal[];
  saved_ars: string;
  saved_usd: string;
  usd_holding: string;
}

export interface Contribution {
  id: number;
  amount: string;
  contribution_date: string;
  note: string | null;
  user_id: number | null;
}

/** Montos de un objetivo: sin ",00", como en las listas. */
export const money = (amount: number | string, currency: Currency) => ledgerAmount(amount, currency);

/** "agosto 2027": el mes es lo que importa de la fecha de un objetivo. */
export const monthLabel = (iso: string) => format(parseISO(iso), "MMMM yyyy", { locale: es });

/**
 * El ritmo dice algo recién con más de un mes de aportes: con uno solo, "venís
 * aportando" es ese aporte. (Lo que ya estaba juntado al crear el objetivo el
 * backend ya no lo cuenta como ritmo.)
 */
export const hasPace = (g: Goal) =>
  g.pace_per_month !== null && Number(g.pace_per_month) > 0 && Number(g.pace_per_month) < Number(g.saved);

/**
 * Lo que dice cada objetivo debajo de su barra: lo que sirve para decidir este mes.
 * Nunca un cero: un objetivo sin aportes no dice "llevás U$D 0".
 */
export function goalStatus(g: Goal): { text: string; tone: "done" | "late" | "plan" | "quiet" } {
  if (g.achieved) return { text: "¡Lo lograste!", tone: "done" };
  if (g.plan_amount && !g.plan_paused && !g.archived) {
    const cuota = money(g.plan_due_amount ?? g.plan_amount, g.currency);
    if (g.plan_due) return { text: `Te toca la cuota del mes: ${cuota}`, tone: "plan" };
    const eta = g.plan_eta ? ` · llegás en ${monthLabel(g.plan_eta)}` : "";
    return { text: `${cuota} cada día ${g.plan_day}${eta}`, tone: "quiet" };
  }
  if (g.overdue) return { text: `Se pasó la fecha: te faltan ${money(g.remaining, g.currency)}`, tone: "late" };
  if (g.per_month_needed !== null && g.months_left !== null) {
    const per = money(g.per_month_needed, g.currency);
    return g.months_left <= 1
      ? { text: `Vence este mes: te faltan ${per}`, tone: "plan" }
      : { text: `Faltan ${g.months_left} meses: ${per} por mes`, tone: "plan" };
  }
  if (g.eta && hasPace(g)) return { text: `A este ritmo llegás en ${monthLabel(g.eta)}`, tone: "quiet" };
  if (Number(g.saved) > 0) return { text: `Te faltan ${money(g.remaining, g.currency)}`, tone: "quiet" };
  return { text: "Todavía no tiene aportes", tone: "quiet" };
}

export const STATUS_TONE = {
  done: "text-emerald-800",
  late: "text-[#3B2FB3]",
  plan: "text-[#3B2FB3]",
  quiet: "text-muted-foreground",
} as const;

export function ProgressBar({ pct, done = false, className = "" }: { pct: number; done?: boolean; className?: string }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)}
      className={`h-2 rounded-full bg-accent overflow-hidden ${className}`}>
      <div className={`h-full rounded-full origin-left transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${done ? "bg-emerald-700" : "bg-primary"}`}
        style={{ transform: `scaleX(${width / 100})` }} />
    </div>
  );
}

// Un monto en un campo se ve como se escribe acá: "4.069.000,00". El backend manda "4069000.00".
const amountText = (n: number | string) =>
  Number(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const thisMonth = () => format(new Date(), "yyyy-MM");

/** Los meses hasta la fecha, contando el actual: el mismo criterio del backend. */
function monthsUntil(ym: string): number {
  const now = new Date();
  const [y, m] = ym.split("-").map(Number);
  return (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1)) + 1;
}

const LABEL = "text-xs font-medium text-muted-foreground";

/** Nuevo objetivo, o editar uno. La moneda no cambia después: los aportes ya están en ella. */
const GOAL_FORM_TOUR: Step[] = [
  { target: "[data-tour='goal-target']", title: "Cuánto querés juntar", content: "En dólares, salvo que elijas pesos: así la meta no se corre con la inflación.", skipBeacon: true },
  { target: "[data-tour='goal-name']", title: "Para qué es", content: "Vacaciones, el auto, un colchón: es el nombre del objetivo.", skipBeacon: true },
  { target: "[data-tour='goal-date']", title: "Para cuándo", content: "Con una fecha te digo cuánto apartar cada mes para llegar.", skipBeacon: true },
  { target: "[data-tour='goal-plan']", title: "Cómo lo juntás", content: "Cuando puedas, o una cuota fija por mes: ese día Inicio te avisa y lo cumplís con un toque.", skipBeacon: true },
  { target: "[data-tour='goal-save']", title: "Crear", content: "Después vas sumando aportes. Apartar plata no es un gasto: no cambia tus movimientos.", skipBeacon: true },
];

export function GoalForm({ goal, presetName = "", onSaved, onClose }: {
  goal?: Goal;
  presetName?: string;
  onSaved: (goal: Goal) => void;
  onClose: () => void;
}) {
  const [currency, setCurrency] = useState<Currency>(goal?.currency ?? "USD");
  const [target, setTarget] = useState(goal ? amountText(goal.target_amount) : "");
  const [name, setName] = useState(goal?.name ?? presetName);
  const [month, setMonth] = useState(goal?.target_date ? goal.target_date.slice(0, 7) : "");
  const [initial, setInitial] = useState("");
  // Cómo se junta: aportes sueltos o una cuota fija por mes.
  const [mode, setMode] = useState<"free" | "monthly">(goal?.plan_amount ? "monthly" : "free");
  const [planAmount, setPlanAmount] = useState(goal?.plan_amount ? amountText(goal.plan_amount) : "");
  const [planTouched, setPlanTouched] = useState(!!goal?.plan_amount);
  const [planDay, setPlanDay] = useState(String(goal?.plan_day ?? 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const targetNum = parseAmount(target) || 0;
  const already = goal ? Number(goal.saved) : parseAmount(initial) || 0;
  const months = month ? monthsUntil(month) : 0;
  const left = Math.max(targetNum - already, 0);
  const perMonth = months > 0 ? Math.ceil((left / months) * 100) / 100 : 0;
  // La cuota propone lo que hace falta por mes hasta que la persona la toca.
  const planShown = planTouched ? planAmount : perMonth > 0 ? amountText(perMonth) : planAmount;
  const planNum = parseAmount(planShown) || 0;
  const dayNum = parseInt(planDay, 10);
  const planMonths = planNum > 0 && left > 0 ? Math.ceil(left / planNum) : 0;
  const planEta = planMonths > 0 ? format(new Date(new Date().getFullYear(), new Date().getMonth() + planMonths - 1, 1), "MMMM yyyy", { locale: es }) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (targetNum <= 0) { setError("Poné cuánto querés juntar."); return; }
    const monthly = mode === "monthly";
    if (monthly && !(planNum > 0)) { setError("Poné cuánto vas a apartar por mes."); return; }
    if (monthly && !(dayNum >= 1 && dayNum <= 28)) { setError("El día va del 1 al 28."); return; }
    const plan = monthly ? { plan_amount: planNum, plan_day: dayNum } : { plan_amount: null };
    setSaving(true);
    const target_date = month ? format(endOfMonth(parseISO(`${month}-01`)), "yyyy-MM-dd") : null;
    try {
      const { data } = goal
        ? await api.patch<Goal>(`/savings/goals/${goal.id}`, { name: name.trim(), target_amount: targetNum, target_date, ...plan })
        : await api.post<Goal>("/savings/goals", {
          name: name.trim(), currency, target_amount: targetNum, target_date, ...(monthly ? plan : {}),
          initial_amount: parseAmount(initial) > 0 ? parseAmount(initial) : undefined,
        });
      onSaved(data);
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar el objetivo."));
      setSaving(false);
    }
  }

  return (
    <>
    <FormSheet title={goal ? "Editar objetivo" : "Nuevo objetivo"} onClose={onClose}>
      {/* Adentro de la hoja: corre en su capa, no en la de la página. */}
      {!goal && <ProductTour tourId="objetivo-form" steps={GOAL_FORM_TOUR} />}
      <form onSubmit={submit} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <div data-tour="goal-target">
          <AmountField
            label="¿Cuánto querés juntar?"
            currency={currency}
            toggle={goal ? undefined : (
              <SegmentedToggle ariaLabel="Moneda" className="w-[120px]" value={currency} onChange={setCurrency}
                options={[{ value: "USD", label: "U$D" }, { value: "ARS", label: "$" }]} />
            )}
            value={target}
            onChange={e => setTarget(e.target.value)}
            autoFocus={!goal}
            required
          />
          </div>
          <div data-tour="goal-name">
            <label htmlFor="goal-name" className={LABEL}>Para qué es</label>
            <input id="goal-name" className={FIELD} required maxLength={80} placeholder="Vacaciones, el auto, un colchón…"
              value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div data-tour="goal-date">
            <span className={LABEL}>¿Para cuándo? <span className="font-normal">(opcional)</span></span>
            <MonthField value={month} onChange={setMonth} min={thisMonth()} />
            {month && (
              <button type="button" onClick={() => setMonth("")}
                className="mt-1 min-h-[36px] text-sm font-medium text-muted-foreground underline underline-offset-2">
                Sin fecha
              </button>
            )}
          </div>
          {!goal && (
            <div>
              <label htmlFor="goal-initial" className={LABEL}>Ya tengo juntado <span className="font-normal">(opcional)</span></label>
              <input id="goal-initial" className={`${FIELD} tabular-nums`} type="text" inputMode="decimal" pattern="[0-9.,]*"
                placeholder="0" value={initial} onChange={e => setInitial(e.target.value)} />
            </div>
          )}
          <div data-tour="goal-plan">
            <span className={LABEL}>¿Cómo lo vas a juntar?</span>
            <SegmentedToggle ariaLabel="Cómo lo vas a juntar" className="mt-1" value={mode} onChange={setMode}
              options={[{ value: "free", label: "Cuando pueda" }, { value: "monthly", label: "Todos los meses" }]} />
            {mode === "monthly" ? (
              <div className="mt-2 grid grid-cols-[1fr_96px] gap-2">
                <div>
                  <label htmlFor="goal-plan-amount" className={LABEL}>Por mes</label>
                  <input id="goal-plan-amount" className={`${FIELD} tabular-nums`} type="text" inputMode="decimal" pattern="[0-9.,]*"
                    placeholder="0" value={planShown} onChange={e => { setPlanTouched(true); setPlanAmount(e.target.value); }} />
                </div>
                <div>
                  <label htmlFor="goal-plan-day" className={LABEL}>El día</label>
                  <input id="goal-plan-day" className={`${FIELD} tabular-nums`} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2}
                    value={planDay} onChange={e => setPlanDay(e.target.value.replace(/\D/g, ""))} />
                </div>
                <p className="col-span-2 px-1 text-sm leading-snug text-[#4A4658]">
                  Ese día de cada mes Inicio te avisa, y lo cumplís con un toque.
                  {planEta && <> Con {money(planNum, currency)} por mes llegás en {planEta}.</>}
                </p>
              </div>
            ) : (
              <p className="mt-1.5 px-1 text-sm leading-snug text-[#4A4658]">Sumás lo que puedas, cuando puedas.</p>
            )}
          </div>
          {/* Con cuota mensual, lo que se aparta por mes ya lo dice la línea de la cuota. */}
          {targetNum > 0 && (mode === "free" || already >= targetNum) && (
            <p className="rounded-[22px] bg-accent border border-[#CFC9E4] px-4 py-3 text-[15px] leading-snug text-foreground" aria-live="polite">
              {already >= targetNum
                ? "Con lo que ya tenés, llegaste."
                : months > 0
                  ? <>Son <strong className="font-semibold tabular-nums">{money(perMonth, currency)} por mes</strong>{months === 1 ? " este mes" : ` durante ${months} meses`}.</>
                  : "Con una fecha te digo cuánto apartar por mes."}
              {!goal && <span className="block mt-1 text-sm text-[#4A4658]">Apartar plata no es un gasto: no cambia tus movimientos ni cómo cierra el mes.</span>}
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label={goal ? "Guardar" : "Crear objetivo"} data-tour="goal-save" />
      </form>
    </FormSheet>
    </>
  );
}

/** Aportar o retirar. Un retiro viaja con el monto en negativo. */
export function ContributionForm({ goal, mode, first, onSaved, onClose }: {
  goal: Goal;
  mode: "in" | "out";
  /** Es el primer aporte: ahí se dice, una vez, que esto no es un gasto. */
  first: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const value = parseAmount(amount);
    if (!(value > 0)) { setError("Poné un monto."); return; }
    setSaving(true);
    try {
      await api.post(`/savings/goals/${goal.id}/contributions`, {
        amount: mode === "out" ? -value : value,
        contribution_date: date || undefined,
        note: note.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar."));
      setSaving(false);
    }
  }

  const saved = Number(goal.saved);
  return (
    <FormSheet title={mode === "in" ? "Aportar" : "Retirar"} onClose={onClose}>
      <form onSubmit={submit} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <AmountField
            label={mode === "in" ? `¿Cuánto apartás para ${goal.name}?` : `¿Cuánto sacás de ${goal.name}?`}
            currency={goal.currency}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            autoFocus
            required
            footer={mode === "out" && saved > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Hay {money(saved, goal.currency)} apartados.</p>
            ) : mode === "in" && !goal.achieved && goal.per_month_needed !== null ? (
              <button type="button" onClick={() => setAmount(amountText(goal.per_month_needed!))}
                className="mt-1 min-h-[32px] text-xs font-medium text-[#3B2FB3] underline underline-offset-2">
                Usar lo de este mes: {money(goal.per_month_needed, goal.currency)}
              </button>
            ) : undefined}
          />
          <div>
            <span className={LABEL}>Fecha</span>
            <DateField value={date} onChange={setDate} required />
          </div>
          <div>
            <label htmlFor="contrib-note" className={LABEL}>Nota <span className="font-normal">(opcional)</span></label>
            <input id="contrib-note" className={FIELD} maxLength={255} value={note} onChange={e => setNote(e.target.value)}
              placeholder={mode === "in" ? "Del aguinaldo, la venta de la bici…" : "Para qué lo sacaste"} />
          </div>
          {first && mode === "in" && (
            <p className="px-1 text-sm leading-snug text-[#4A4658]">
              Apartar plata no es un gasto: no aparece en Movimientos ni cambia cómo cierra el mes. Sólo la ponés aparte.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label={mode === "in" ? "Aportar" : "Retirar"} />
      </form>
    </FormSheet>
  );
}
