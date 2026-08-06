"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { formatARS, formatDate, formatUSD, getErrorMessage, parseAmount } from "@/lib/utils";
import {
  ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight,
  Plus, Pencil, Trash2, Wallet,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ARGENTINE_BANKS } from "@/lib/banks";

const INPUT = "mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground";

// Same vocabulary as the shared-expense settlement conversion (backend
// RATE_TYPES). "personalizado" isn't offered as a household valuation setting —
// no macro series backs it — but a single operation can carry it.
const RATE_TYPE_LABELS: Record<string, string> = {
  oficial: "Oficial",
  blue: "Blue",
  mayorista: "Mayorista",
  mep: "MEP",
  ccl: "CCL",
  personalizado: "Personalizado",
};

type OpType = "buy" | "sell" | "initial" | "adjustment";

const OP_LABELS: Record<OpType, string> = {
  buy: "Compra",
  sell: "Venta",
  initial: "Tenencia inicial",
  adjustment: "Ajuste",
};

interface Operation {
  id: number;
  op_type: OpType;
  operation_date: string;
  currency: string;
  foreign_amount: string;
  ars_amount: string | null;
  rate: string | null;
  rate_type: string | null;
  entity: string | null;
  notes: string | null;
}

interface Summary {
  currency: string;
  period: string;
  holding: string;
  holding_start: string;
  initial: string;
  start_date: string | null;
  total_bought: string;
  total_sold: string;
  total_spent: string;
  total_adjustments: string;
  total_earned: string;
  pending_usd: string;
  next_due_date: string | null;
  bought_usd: string;
  bought_ars: string;
  sold_usd: string;
  sold_ars: string;
  spent_usd: string;
  adjustments_usd: string;
  net_usd: string;
  rate: string | null;
  rate_type: string;
  valuation_ars: string | null;
}

interface MacroRow {
  usd_official: string | null;
  usd_blue: string | null;
  usd_mayorista: string | null;
  usd_mep: string | null;
  usd_ccl: string | null;
}

const EMPTY_FORM = {
  op_type: "buy" as OpType,
  operation_date: "",
  usd: "",
  rate: "",
  ars: "",
  rate_type: "blue",
  entity: "",
  entityMode: "banco" as "banco" | "personalizado",
  notes: "",
  // Direction for `adjustment` only — the other types have a fixed sign.
  adjustSign: "+" as "+" | "-",
};

function StatTile({ label, value, hint, tone = "neutral" }: {
  label: string; value: string; hint?: string; tone?: "neutral" | "emerald" | "rose";
}) {
  const toneClass =
    tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <div className="p-3 md:p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm md:text-base font-bold break-words ${toneClass}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

export default function DivisasPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [ops, setOps] = useState<Operation[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // Which of the three linked amount fields the user typed last, so we only
  // ever recompute the other one instead of fighting their input.
  const lastEdited = useRef<"usd" | "rate" | "ars">("usd");

  const periodLabel = format(new Date(year, month - 1), "MMMM yyyy", { locale: es });
  const hasInitial = ops.some(o => o.op_type === "initial");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o] = await Promise.all([
        api.get<Summary>(`/currency/summary/${year}/${month}`),
        api.get<Operation[]>("/currency/operations", { params: { year, month } }),
      ]);
      setSummary(s.data);
      setOps(o.data);
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  // Suggested quotes, same source the shared-expense conversion modal uses.
  useEffect(() => {
    const from = new Date();
    from.setDate(from.getDate() - 14);
    api.get<MacroRow[]>("/macro", { params: { from_date: from.toISOString().slice(0, 10) } })
      .then(res => {
        const row = res.data?.[0];
        if (!row) return;
        setRates({
          oficial: Number(row.usd_official) || 0,
          blue: Number(row.usd_blue) || 0,
          mayorista: Number(row.usd_mayorista) || 0,
          mep: Number(row.usd_mep) || 0,
          ccl: Number(row.usd_ccl) || 0,
        });
      })
      .catch(() => {});
  }, []);

  const prev = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
  };
  const next = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
  };

  // buy/sell actually move pesos, so their ARS leg is stored and required.
  // An adjustment gets the same converter purely as a calculator — no pesos
  // changed hands, so sending an amount would corrupt `ars_available`.
  const hasArsLeg = form.op_type === "buy" || form.op_type === "sell";
  const showConverter = hasArsLeg || form.op_type === "adjustment";

  // The quote is the anchor: type dollars and get pesos, or type pesos and get
  // dollars. 660 @ 1515 -> 999.900, and 999.900 @ 1515 -> 660.
  const syncAmounts = (next: typeof form, changed: "usd" | "rate" | "ars") => {
    const rate = parseAmount(next.rate);
    if (changed !== "rate") lastEdited.current = changed;
    if (rate <= 0) return next;

    const usd = parseAmount(next.usd);
    const ars = parseAmount(next.ars);

    if (changed === "usd") {
      next.ars = usd > 0 ? (usd * rate).toFixed(2) : "";
    } else if (changed === "ars") {
      next.usd = ars > 0 ? (ars / rate).toFixed(2) : "";
    } else {
      // Quote changed — recompute whichever amount the user didn't type last,
      // so their own number is never overwritten.
      if (lastEdited.current === "ars" && ars > 0) next.usd = (ars / rate).toFixed(2);
      else if (usd > 0) next.ars = (usd * rate).toFixed(2);
    }
    return next;
  };

  const openNew = (opType: OpType) => {
    setEditId(null);
    setForm({
      ...EMPTY_FORM,
      op_type: opType,
      operation_date: new Date().toISOString().slice(0, 10),
      rate: rates.blue ? String(rates.blue) : "",
    });
    setShowForm(true);
  };

  const openEdit = (op: Operation) => {
    const amount = Number(op.foreign_amount);
    setEditId(op.id);
    setForm({
      op_type: op.op_type,
      operation_date: op.operation_date,
      usd: String(Math.abs(amount)),
      rate: op.rate ? String(Number(op.rate)) : "",
      ars: op.ars_amount ? String(Number(op.ars_amount)) : "",
      rate_type: op.rate_type || "blue",
      entity: op.entity || "",
      // An entity that isn't on the bank list came from the free-text field.
      entityMode: op.entity && !ARGENTINE_BANKS.some(b => b.name === op.entity)
        ? "personalizado" : "banco",
      notes: op.notes || "",
      adjustSign: amount < 0 ? "-" : "+",
    });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const usd = parseAmount(form.usd);
    if (!usd) { setError("Ingresá un monto en dólares"); return; }

    // The API takes a signed amount: positive means currency came in.
    let foreign = Math.abs(usd);
    if (form.op_type === "sell") foreign = -foreign;
    if (form.op_type === "adjustment" && form.adjustSign === "-") foreign = -foreign;

    const payload: Record<string, unknown> = {
      op_type: form.op_type,
      operation_date: form.operation_date,
      foreign_amount: foreign,
      entity: form.entity || null,
      notes: form.notes || null,
    };
    if (hasArsLeg) {
      const ars = parseAmount(form.ars);
      if (!ars) { setError("Ingresá el monto en pesos"); return; }
      payload.ars_amount = ars;
      const rate = parseAmount(form.rate);
      if (rate) payload.rate = rate;
      payload.rate_type = form.rate_type;
    }

    setSaving(true);
    try {
      if (editId) await api.patch(`/currency/operations/${editId}`, payload);
      else await api.post("/currency/operations", { ...payload, currency: "USD" });
      closeForm();
      await load();
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (op: Operation) => {
    if (!confirm(`¿Eliminar esta operación de ${formatUSD(Math.abs(Number(op.foreign_amount)))}?`)) return;
    try {
      await api.delete(`/currency/operations/${op.id}`);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const holding = Number(summary?.holding ?? 0);
  const valuation = summary?.valuation_ars != null ? Number(summary.valuation_ars) : null;

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Divisas</h2>
        <div className="flex gap-1 md:gap-2 shrink-0">
          {!hasInitial && !loading && (
            <Button variant="outline" onClick={() => openNew("initial")}>
              Tenencia inicial
            </Button>
          )}
          <Button onClick={() => openNew("buy")}>
            <Plus className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Operación</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <Card variant="hero" className="h-36 animate-pulse" />
      ) : (
        <>
          {/* Hero — the stock. It carries across months: dollars bought in one
              month to pay the next month's card statement stay on the books. */}
          <Card variant="hero" className="p-5 md:p-8">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Tenencia en dólares
            </p>
            <p className="text-4xl md:text-5xl font-display font-bold text-foreground mt-1">
              {formatUSD(holding)}
            </p>
            {valuation !== null && (
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                ≈ {formatARS(valuation)}
                <span className="text-muted-foreground/70">
                  {" "}· {RATE_TYPE_LABELS[summary!.rate_type] ?? summary!.rate_type} {formatARS(Number(summary!.rate))}
                </span>
              </p>
            )}
            {/* Where the number comes from. The month tiles below only cover the
                selected month, but the holding accumulates since start_date —
                without this the total is impossible to reconcile from screen. */}
            {summary && hasInitial && (
              <div className="mt-4 pt-3 border-t border-border/60 text-sm space-y-1">
                <p className="text-xs text-muted-foreground mb-1.5">
                  Desde tu tenencia inicial del {formatDate(summary.start_date!)}
                </p>
                {[
                  { label: "Tenencia inicial", value: Number(summary.initial), sign: "" },
                  { label: "Comprado", value: Number(summary.total_bought), sign: "+" },
                  { label: "Ingresado en USD", value: Number(summary.total_earned), sign: "+" },
                  { label: "Vendido", value: Number(summary.total_sold), sign: "−" },
                  { label: "Pagado en USD", value: Number(summary.total_spent), sign: "−" },
                  { label: "Ajustes", value: Number(summary.total_adjustments), sign: "" },
                ]
                  .filter(r => r.value !== 0 || r.label === "Tenencia inicial")
                  .map(r => (
                    <p key={r.label} className="flex justify-between gap-4 text-muted-foreground">
                      <span>{r.sign} {r.label}</span>
                      <span className="font-medium tabular-nums">{formatUSD(Math.abs(r.value))}</span>
                    </p>
                  ))}
                <p className="flex justify-between gap-4 font-semibold text-foreground pt-1">
                  <span>= Tenencia actual</span>
                  <span className="tabular-nums">{formatUSD(holding)}</span>
                </p>
              </div>
            )}

            {/* Card purchases already billed but not yet due. The dollars are
                still held, so they're not subtracted above — but they're
                already committed, which is exactly when the user needs to buy. */}
            {summary && Number(summary.pending_usd) > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-800">
                  <strong>{formatUSD(Number(summary.pending_usd))} comprometidos</strong> en
                  consumos con tarjeta ya facturados
                  {summary.next_due_date && <> · vencen el {formatDate(summary.next_due_date)}</>}.
                  Todavía no salieron de tu tenencia.
                </p>
              </div>
            )}
            {!hasInitial && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Cargá tu <strong>tenencia inicial</strong> para que este número refleje los dólares
                que ya tenías antes de empezar a registrar.
              </p>
            )}
          </Card>

          <div className="flex justify-end">
            <div className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-card shadow-chip pl-3 pr-1.5 py-1.5">
              <CalendarDays className="w-4 h-4 text-primary shrink-0" />
              <button onClick={prev} className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-bold text-foreground capitalize px-0.5 min-w-[100px] text-center">{periodLabel}</span>
              <button onClick={next} className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Flow — what happened inside the selected month. */}
          {summary && (
            <Card className="p-0 md:p-0">
              <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0">
                <StatTile
                  label="Compré" tone="emerald"
                  value={formatUSD(Number(summary.bought_usd))}
                  hint={Number(summary.bought_ars) > 0 ? `con ${formatARS(Number(summary.bought_ars))}` : undefined}
                />
                <StatTile
                  label="Vendí" tone="rose"
                  value={formatUSD(Number(summary.sold_usd))}
                  hint={Number(summary.sold_ars) > 0 ? `por ${formatARS(Number(summary.sold_ars))}` : undefined}
                />
                <StatTile
                  label="Pagué" tone="rose"
                  value={formatUSD(Number(summary.spent_usd))}
                  hint="resúmenes vencidos + contado"
                />
                <StatTile
                  label="Neto del mes"
                  tone={Number(summary.net_usd) >= 0 ? "emerald" : "rose"}
                  value={`${Number(summary.net_usd) >= 0 ? "+" : "−"}${formatUSD(Math.abs(Number(summary.net_usd)))}`}
                  hint={`de ${formatUSD(Number(summary.holding_start))} a ${formatUSD(holding)}`}
                />
              </div>
            </Card>
          )}
        </>
      )}

      {showForm && (
        <Card className="p-4 md:p-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-sm font-medium text-foreground">
              {editId ? "Editar operación" : "Nueva operación"}
            </p>

            <div className="flex gap-2">
              {(["buy", "sell", "adjustment"] as const).map(t => (
                <button key={t} type="button"
                  onClick={() => setForm(p => ({ ...p, op_type: t }))}
                  disabled={form.op_type === "initial"}
                  className={`flex-1 py-1.5 text-xs rounded-full border-2 font-medium transition-colors disabled:opacity-40 ${form.op_type === t ? "border-ink bg-primary text-primary-foreground" : "border-transparent text-muted-foreground hover:bg-accent"}`}>
                  {OP_LABELS[t]}
                </button>
              ))}
            </div>

            {form.op_type === "initial" && (
              <p className="text-xs text-primary bg-accent border border-border rounded-lg px-3 py-2">
                Los dólares que ya tenías a esta fecha. Los consumos en USD
                <strong> anteriores</strong> a ella no se descuentan: ya están reflejados en este número.
              </p>
            )}
            {form.op_type === "buy" && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                No es un egreso: los pesos no se gastan, cambian de moneda. No entra en tus
                categorías de gastos, pero sí descuenta de los pesos disponibles del mes.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Fecha</label>
                <input type="date" className={INPUT} value={form.operation_date}
                  onChange={e => setForm(p => ({ ...p, operation_date: e.target.value }))} required />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Monto (U$D)</label>
                <div className="flex gap-2">
                  {form.op_type === "adjustment" && (
                    <select className={`${INPUT} w-16 shrink-0`} value={form.adjustSign}
                      onChange={e => setForm(p => ({ ...p, adjustSign: e.target.value as "+" | "-" }))}>
                      <option value="+">+</option>
                      <option value="-">−</option>
                    </select>
                  )}
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={INPUT}
                    value={form.usd}
                    onChange={e => setForm(p => syncAmounts({ ...p, usd: e.target.value }, "usd"))}
                    required />
                </div>
              </div>

              {showConverter && (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Cotización ($ por U$D)</label>
                    <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={INPUT}
                      value={form.rate}
                      onChange={e => setForm(p => syncAmounts({ ...p, rate: e.target.value, rate_type: "personalizado" }, "rate"))}
                      required={hasArsLeg} />
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.entries(rates).filter(([, v]) => v > 0).map(([type, value]) => (
                        <button key={type} type="button"
                          onClick={() => setForm(p => syncAmounts({ ...p, rate: String(value), rate_type: type }, "rate"))}
                          className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${form.rate_type === type ? "border-ink bg-accent text-primary font-medium" : "border-border text-muted-foreground hover:bg-accent"}`}>
                          {RATE_TYPE_LABELS[type]} {value.toLocaleString("es-AR")}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      {form.op_type === "buy" ? "Pesos que pagué"
                        : form.op_type === "sell" ? "Pesos que recibí"
                        : "Equivalente en pesos"}
                    </label>
                    <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={INPUT}
                      value={form.ars}
                      onChange={e => setForm(p => syncAmounts({ ...p, ars: e.target.value }, "ars"))}
                      required={hasArsLeg} />
                    {!hasArsLeg && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Solo para calcular los dólares. Un ajuste no mueve pesos, así que no
                        se guarda ni afecta tu balance.
                      </p>
                    )}
                  </div>
                </>
              )}

              {hasArsLeg && (
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Entidad (opcional)</label>
                  <div className="flex gap-2 mt-1 mb-2">
                    {(["banco", "personalizado"] as const).map(mode => (
                      <button key={mode} type="button"
                        onClick={() => setForm(p => ({ ...p, entityMode: mode, entity: "" }))}
                        className={`px-3 py-1 text-xs rounded-full border-2 font-medium transition-colors ${form.entityMode === mode ? "border-ink bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}>
                        {mode === "banco" ? "Banco" : "Personalizado"}
                      </button>
                    ))}
                  </div>
                  {form.entityMode === "banco" ? (
                    <select className={INPUT} value={form.entity}
                      onChange={e => setForm(p => ({ ...p, entity: e.target.value }))}>
                      <option value="">Sin especificar</option>
                      {ARGENTINE_BANKS.map(b => (
                        <option key={b.name} value={b.name}>{b.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input className={INPUT} placeholder="Broker, cueva, persona..."
                      value={form.entity}
                      onChange={e => setForm(p => ({ ...p, entity: e.target.value }))} />
                  )}
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Notas (opcional)</label>
                <input className={INPUT} value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={closeForm}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0 md:p-0 divide-y">
        {ops.length === 0 && !loading ? (
          <div className="p-8 text-center">
            <ArrowLeftRight className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">
              No hay operaciones en {periodLabel}.
            </p>
          </div>
        ) : (
          ops.map(op => {
            const amount = Number(op.foreign_amount);
            const isIn = amount > 0;
            return (
              <div key={op.id} className="flex items-center gap-3 p-3 md:p-4">
                <div className={`p-2 rounded-xl shrink-0 ${isIn ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                  {op.op_type === "initial" ? <Wallet className="w-4 h-4" /> : <ArrowLeftRight className="w-4 h-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {OP_LABELS[op.op_type]}
                    {op.entity && <span className="text-muted-foreground font-normal"> · {op.entity}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(op.operation_date)}
                  </p>
                  {op.notes && <p className="text-xs text-muted-foreground/80 truncate">{op.notes}</p>}
                </div>
                <p className={`text-sm font-bold shrink-0 ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                  {isIn ? "+" : "−"}{formatUSD(Math.abs(amount))}
                </p>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(op)} aria-label="Editar"
                    className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(op)} aria-label="Eliminar"
                    className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-rose-600 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
