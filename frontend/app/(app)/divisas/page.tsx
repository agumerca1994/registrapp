"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown, ListX, MoreVertical, Wallet } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatARSRound, formatUSD, getErrorMessage, parseAmount } from "@/lib/utils";
import { useCountUp } from "@/components/ui/count-up";
import { Card } from "@/components/ui/card";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { Fab } from "@/components/ui/fab";
import { ScrollRow } from "@/components/ui/scroll-row";
import { DateField, FIELD, SegmentedToggle, SelectField } from "@/components/ui/form";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import { MonthPill } from "@/components/dashboard/MonthPill";
import { LoadedByTag, useLoadedBy } from "@/components/LoadedBy";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { BLOCK, GLASS } from "@/components/ui/glass";
import { EntrySheet, SheetActions, SheetRow } from "@/components/movimientos/EntrySheet";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { LedgerRow, ledgerAmount } from "@/components/movimientos/Ledger";
import { useNuevo } from "@/lib/nuevo";
import { ARGENTINE_BANKS } from "@/lib/banks";

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
  user_id: number | null;
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
  pending_own_usd: string;
  pending_others_usd: string;
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

// El bloque de color de la pantalla, como el de Inicio: la tenencia es su cifra.

// Un monto en un campo se ve como se escribe acá: "4.069.000,00". El backend manda "4069000.00".
const amountText = (n: number | string) =>
  Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LABEL = "text-xs font-medium text-muted-foreground";

// "al blue de $ 1.570", pero "al MEP de $ 1.581".
const rateName = (type: string) => {
  const label = RATE_TYPE_LABELS[type] ?? type;
  return label.length > 3 ? label.toLowerCase() : label;
};

const signed = (amount: number) => `${amount >= 0 ? "+" : "−"}${ledgerAmount(Math.abs(amount), "USD")}`;

/** La tenencia: el número entero se lee primero, y los centavos sólo si los hay. */
function HoldingFigure({ amount }: { amount: number }) {
  const counted = useCountUp(amount);
  const text = ledgerAmount(counted, "USD");
  const comma = text.lastIndexOf(",");
  return (
    <p className="font-medium leading-[1.08] tracking-[-0.045em] tabular-nums text-[clamp(2.5rem,13vw,3.5rem)]">
      {comma >= 0 ? text.slice(0, comma) : text}
      {comma >= 0 && <span className="text-[0.55em] tracking-[-0.02em] text-white/80">{text.slice(comma)}</span>}
    </p>
  );
}

function DetailRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 text-[15px] ${strong ? "font-semibold" : ""}`}>
      <span className="min-w-0">{label}</span>
      <span className="tabular-nums text-right shrink-0">{value}</span>
    </div>
  );
}

/**
 * El flujo del mes, aparte de la tenencia: una es cuánto hay, el otro qué pasó en
 * estos 30 días. Lo que dio cero no se muestra, y si no pasó nada no hay bloque.
 */
function MonthFlow({ summary, holding, monthName }: { summary: Summary; holding: number; monthName: string }) {
  const bought = Number(summary.bought_usd);
  const sold = Number(summary.sold_usd);
  const spent = Number(summary.spent_usd);
  const adjusted = Number(summary.adjustments_usd);
  const net = Number(summary.net_usd);
  const start = Number(summary.holding_start);
  const items = [
    bought !== 0 && {
      label: "Compré", value: ledgerAmount(bought, "USD"),
      hint: Number(summary.bought_ars) > 0 ? `con ${formatARSRound(summary.bought_ars)}` : undefined,
    },
    sold !== 0 && {
      label: "Vendí", value: ledgerAmount(sold, "USD"),
      hint: Number(summary.sold_ars) > 0 ? `por ${formatARSRound(summary.sold_ars)}` : undefined,
    },
    spent !== 0 && { label: "Pagué", value: ledgerAmount(spent, "USD"), hint: "resúmenes vencidos y contado" },
    adjusted !== 0 && { label: "Ajusté", value: signed(adjusted), hint: undefined },
  ].filter(Boolean) as { label: string; value: string; hint?: string }[];
  if (items.length === 0) return null;

  // Con un solo movimiento, el neto repite la fila de al lado. El "de X a Y" va sólo
  // si cierra: el neto toma el mes entero y la tenencia frena en hoy, y tampoco
  // cuenta lo cobrado en dólares. Dos cifras que no cierran se leen como un error.
  if (items.length > 1) {
    const closes = Math.abs(start + net - holding) < 0.005;
    items.push({
      label: "Neto del mes", value: signed(net),
      hint: closes ? `de ${ledgerAmount(start, "USD")} a ${ledgerAmount(holding, "USD")}` : undefined,
    });
  }

  return (
    <Card className="px-0 py-3.5 md:px-0 md:py-4">
      <h2 className="px-4 md:px-5 mb-2 text-[15px] font-medium text-muted-foreground first-letter:uppercase">En {monthName}</h2>
      {/* Altura fija: una grilla crecía con cada movimiento y mandaba la lista abajo. */}
      <ScrollRow gap="gap-2" className="px-4 md:px-5">
        {items.map(item => (
          <div key={item.label} className="shrink-0 min-h-[52px] rounded-2xl border border-border bg-background/60 px-3 py-1.5">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="text-[15px] font-semibold tabular-nums text-foreground whitespace-nowrap">{item.value}</p>
            {item.hint && <p className="text-xs text-muted-foreground whitespace-nowrap">{item.hint}</p>}
          </div>
        ))}
      </ScrollRow>
    </Card>
  );
}

export default function DivisasPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const loadedBy = useLoadedBy();
  const reaccionar = useReaccion();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [ops, setOps] = useState<Operation[]>([]);
  // De qué mes son las operaciones ya cargadas: la lista de otro mes funde entera.
  const [opsKey, setOpsKey] = useState("");
  const [rates, setRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [viewing, setViewing] = useState<Operation | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // Which of the three linked amount fields the user typed last, so we only
  // ever recompute the other one instead of fighting their input.
  const lastEdited = useRef<"usd" | "rate" | "ars">("usd");

  const monthDate = new Date(year, month - 1);
  const periodLabel = format(monthDate, "MMMM yyyy", { locale: es });
  const monthName = format(monthDate, "MMMM", { locale: es });
  const pillLabel = format(monthDate, "MMM yyyy", { locale: es }).replace(".", "");
  const hasInitial = ops.some(o => o.op_type === "initial");
  const isPast = year < today.getFullYear() || (year === today.getFullYear() && month < today.getMonth() + 1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o] = await Promise.all([
        api.get<Summary>(`/currency/summary/${year}/${month}`),
        api.get<Operation[]>("/currency/operations", { params: { year, month } }),
      ]);
      setSummary(s.data);
      setOps(o.data);
      setOpsKey(`${year}-${month}`);
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e, "No se pudieron cargar los dólares de este mes."));
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
      next.ars = usd > 0 ? amountText(usd * rate) : "";
    } else if (changed === "ars") {
      next.usd = ars > 0 ? amountText(ars / rate) : "";
    } else {
      // Quote changed — recompute whichever amount the user didn't type last,
      // so their own number is never overwritten.
      if (lastEdited.current === "ars" && ars > 0) next.usd = amountText(ars / rate);
      else if (usd > 0) next.ars = amountText(usd * rate);
    }
    return next;
  };

  const openNew = (opType: OpType) => {
    setEditId(null);
    setFormError(null);
    setForm({
      ...EMPTY_FORM,
      op_type: opType,
      // La fecha de acá, no la de UTC: a la noche ya sería mañana.
      operation_date: format(new Date(), "yyyy-MM-dd"),
      rate: rates.blue ? amountText(rates.blue) : "",
    });
    setShowForm(true);
  };

  useNuevo(() => openNew("buy"), "nuevo");

  const openEdit = (op: Operation) => {
    const amount = Number(op.foreign_amount);
    setViewing(null);
    setEditId(op.id);
    setFormError(null);
    setForm({
      op_type: op.op_type,
      operation_date: op.operation_date,
      usd: amountText(Math.abs(amount)),
      rate: op.rate ? amountText(op.rate) : "",
      ars: op.ars_amount ? amountText(op.ars_amount) : "",
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

  const closeForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); setFormError(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const usd = parseAmount(form.usd);
    if (!usd) { setFormError("Ingresá el monto en dólares."); return; }

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
      if (!ars) { setFormError("Ingresá el monto en pesos."); return; }
      payload.ars_amount = ars;
      const rate = parseAmount(form.rate);
      if (rate) payload.rate = rate;
      payload.rate_type = form.rate_type;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (editId) await api.patch(`/currency/operations/${editId}`, payload);
      else await api.post("/currency/operations", { ...payload, currency: "USD" });
      const saved = form.op_type === "adjustment" ? "Ajuste guardado" : `${OP_LABELS[form.op_type]} guardada`;
      closeForm();
      await load();
      reaccionar("guardado", saved);
    } catch (err) {
      setFormError(getErrorMessage(err, "No se pudo guardar la operación. Probá de nuevo."));
      reaccionar("error", "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (op: Operation) => {
    setViewing(null);
    try {
      await api.delete(`/currency/operations/${op.id}`);
      await load();
      reaccionar("borrado", "Operación eliminada");
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo eliminar la operación. Probá de nuevo."));
      reaccionar("error", "No se pudo eliminar");
    }
  };

  const holding = Number(summary?.holding ?? 0);
  const valuation = summary?.valuation_ars != null ? Number(summary.valuation_ars) : null;
  const canDetail = !!summary && hasInitial;
  // Sin tenencia inicial ni operaciones no hay nada que contar: un "U$D 0" enorme no dice nada.
  const nothingYet = !loading && !error && !hasInitial && ops.length === 0 && holding === 0;

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground">Divisas</h1>
        <div className="flex items-center gap-0.5 shrink-0">
          <MonthPill compact label={pillLabel} onPrev={prev} onNext={next} />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button title="Más acciones" aria-label="Más acciones"
                className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none">
                <MoreVertical className="w-5 h-5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4}
                className="rounded-[22px] border border-white/70 bg-card/90 backdrop-blur-2xl backdrop-saturate-150 shadow-flota p-1.5 animate-fade-in w-48 z-50">
                <DropdownMenu.Item asChild>
                  <PrivacyMenuItem />
                </DropdownMenu.Item>
                {/* Declaring the opening balance happens once in the life of the
                    household, so it stays out of the way behind the ⋮ — but only
                    while there isn't one, since a second is rejected anyway. */}
                {!hasInitial && !loading && (
                  <DropdownMenu.Item asChild>
                    <button onClick={() => openNew("initial")}
                      className="flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-sm text-foreground hover:bg-accent w-full outline-none cursor-pointer">
                      <Wallet className="w-4 h-4 text-muted-foreground" /> Tenencia inicial
                    </button>
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] text-rose-900">
          <p>{error}</p>
          <button onClick={load} className="mt-1 font-semibold underline">Probar de nuevo</button>
        </div>
      )}

      {loading && !summary ? (
        <div aria-busy="true" className={`${BLOCK} h-[168px] animate-pulse`}>
          <span className="sr-only">Cargando tus dólares</span>
        </div>
      ) : summary && (
        <>
          {/* El stock, no el flujo: los dólares comprados un mes para pagar el
              resumen del siguiente siguen acá hasta que salen. */}
          {!nothingYet && <section className={BLOCK}>
            <div className="px-2.5">
              <p className="text-[16.5px] font-medium">
                {isPast ? `Tenías al cierre de ${monthName}` : "Tenés hoy"}
              </p>
              <HoldingFigure amount={holding} />
              {valuation !== null && holding !== 0 && (
                <p className="mt-1.5 text-[15.5px] leading-snug">
                  Son {formatARSRound(valuation)} al {rateName(summary.rate_type)} de {formatARSRound(Number(summary.rate))}
                </p>
              )}
            </div>

            {/* The month rows only cover the selected month, but the holding
                accumulates since start_date — without this chain the total is
                impossible to reconcile from the screen. */}
            {canDetail && (
              <MotionList className={`mt-3.5 ${GLASS}`}>
                <button onClick={() => setShowDetail(v => !v)} aria-expanded={showDetail}
                  className="w-full min-h-[46px] px-4 flex items-center justify-between gap-3 text-[15px] font-medium">
                  {showDetail ? "Ver menos" : "Ver detalle"}
                  <ChevronDown className={`w-[18px] h-[18px] transition-transform ${showDetail ? "rotate-180" : ""}`} />
                </button>
                {showDetail && (
                  <div className="px-4 pb-2 divide-y divide-white/[0.18] border-t border-white/[0.18]">
                    <DetailRow label={`Tenencia inicial, ${format(parseISO(summary.start_date!), "d MMM yyyy", { locale: es }).replace(".", "")}`}
                      value={formatUSD(Number(summary.initial))} />
                    {Number(summary.total_bought) !== 0 && (
                      <DetailRow label="Comprado" value={`+${formatUSD(Number(summary.total_bought))}`} />
                    )}
                    {Number(summary.total_earned) !== 0 && (
                      <DetailRow label="Cobrado en dólares" value={`+${formatUSD(Number(summary.total_earned))}`} />
                    )}
                    {Number(summary.total_sold) !== 0 && (
                      <DetailRow label="Vendido" value={`−${formatUSD(Number(summary.total_sold))}`} />
                    )}
                    {Number(summary.total_spent) !== 0 && (
                      <DetailRow label="Pagado en dólares" value={`−${formatUSD(Number(summary.total_spent))}`} />
                    )}
                    {Number(summary.total_adjustments) !== 0 && (
                      <DetailRow label="Ajustes"
                        value={`${Number(summary.total_adjustments) >= 0 ? "+" : "−"}${formatUSD(Math.abs(Number(summary.total_adjustments)))}`} />
                    )}
                    <DetailRow strong label="Tengo" value={formatUSD(holding)} />
                  </div>
                )}
              </MotionList>
            )}
          </section>}

          {!hasInitial && !loading && (
            <section className="rounded-3xl p-4 bg-accent border border-[#CFC9E4]">
              <p className="text-[15.5px] font-semibold text-foreground">¿Ya tenías dólares?</p>
              <p className="mt-0.5 text-[15px] leading-snug text-[#4A4658]">
                {nothingYet
                  ? "Cargá tu tenencia inicial: lo que tenías antes de empezar a registrar. Desde ahí se cuenta todo."
                  : "Cargá tu tenencia inicial para que este número refleje lo que tenías antes de empezar a registrar."}
              </p>
              <button onClick={() => openNew("initial")}
                className="mt-3 h-11 px-5 rounded-full bg-ink text-background text-sm font-semibold active:scale-[0.97] transition-transform duration-100">
                Cargar tenencia inicial
              </button>
            </section>
          )}

          {/* What the bank will actually debit — gross, including the share
              of shared expenses that belongs to other participants. The
              shortfall is a cash-timing warning, not a net-worth one: the
              holding above already assumes participants reimburse. */}
          {Number(summary.pending_usd) > 0 && (() => {
            const total = Number(summary.pending_usd);
            const own = Number(summary.pending_own_usd);
            const others = Number(summary.pending_others_usd);
            const shortfall = total - holding;
            return (
              <section className="rounded-3xl p-4 bg-accent border border-[#CFC9E4] text-[15px]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold text-foreground">
                    Vence {summary.next_due_date
                      ? `el ${format(parseISO(summary.next_due_date), "d 'de' MMMM", { locale: es })}`
                      : "próximamente"}
                  </p>
                  <p className="text-lg font-medium tabular-nums text-foreground shrink-0">{ledgerAmount(total, "USD")}</p>
                </div>
                <p className="mt-0.5 text-[#3B2FB3] font-medium">
                  {shortfall > 0
                    ? `Faltan ${ledgerAmount(shortfall, "USD")} si nadie te transfirió todavía`
                    : `Te alcanza: te quedarían ${ledgerAmount(-shortfall, "USD")} en la cuenta`}
                </p>
                {others > 0 && (
                  <p className="mt-1.5 text-sm leading-snug text-[#4A4658]">
                    {ledgerAmount(own, "USD")} son tuyos y {ledgerAmount(others, "USD")} de participantes. El banco debita
                    el total y ellos te reintegran su parte: una vez liquidado te quedan {ledgerAmount(holding - own, "USD")}.
                  </p>
                )}
              </section>
            );
          })()}

          <MonthFlow summary={summary} holding={holding} monthName={monthName} />
        </>
      )}

      {!(error && ops.length === 0) && <section className="px-2">
        <h2 className="mb-1 text-[22px] font-medium tracking-[-0.03em] text-foreground">Operaciones</h2>
        <MotionList key={opsKey} className="animate-page-in">
        {!loading && !error && ops.length === 0 ? (
          <div className="py-4 text-[15px] text-muted-foreground">
            <ListX className="w-7 h-7 mb-2 text-muted-foreground/50" strokeWidth={1.6} aria-hidden="true" />
            No hay operaciones en {periodLabel}. Cuando compres o vendas dólares, cargalo con el +.
          </div>
        ) : (
          <MotionList>
            {ops.map((op, i) => {
              const amount = Number(op.foreign_amount);
              const pesos = op.ars_amount != null ? formatARSRound(op.ars_amount) : null;
              const who = loadedBy.nameOf(op.user_id);
              const line = [op.entity, pesos && (op.op_type === "buy" ? `con ${pesos}` : `por ${pesos}`), op.notes].filter(Boolean).join(" · ");
              return (
                <LedgerRow key={op.id}
                  date={op.operation_date}
                  showDate={i === 0 || ops[i - 1].operation_date !== op.operation_date}
                  title={OP_LABELS[op.op_type]}
                  sub={(line || who) ? <>
                    {line && <span className="block truncate">{line}</span>}
                    <LoadedByTag name={who} />
                  </> : undefined}
                  amount={signed(amount)}
                  positive={amount > 0}
                  onOpen={() => setViewing(op)}
                />
              );
            })}
          </MotionList>
        )}
        </MotionList>
      </section>}

      <Fab label="Nueva operación" onClick={() => openNew("buy")} />

      {viewing && (
        <EntrySheet
          date={viewing.operation_date}
          title={OP_LABELS[viewing.op_type]}
          amount={`${Number(viewing.foreign_amount) >= 0 ? "+" : "−"}${formatUSD(Math.abs(Number(viewing.foreign_amount)))}`}
          positive={Number(viewing.foreign_amount) > 0}
          onClose={() => setViewing(null)}
          footer={<SheetActions noun="movimiento" onEdit={() => openEdit(viewing)} onDelete={() => handleDelete(viewing)} />}
        >
          {viewing.ars_amount != null && (
            <SheetRow label={viewing.op_type === "buy" ? "Pesos que pagué" : "Pesos que recibí"}>
              <span className="tabular-nums">{formatARS(viewing.ars_amount)}</span>
            </SheetRow>
          )}
          {viewing.rate != null && (
            <SheetRow label="Cotización">
              <span className="tabular-nums">
                {viewing.rate_type && RATE_TYPE_LABELS[viewing.rate_type] ? `${RATE_TYPE_LABELS[viewing.rate_type]} ` : ""}{formatARS(viewing.rate)}
              </span>
            </SheetRow>
          )}
          {viewing.entity && <SheetRow label="Entidad">{viewing.entity}</SheetRow>}
          {viewing.notes && <SheetRow label="Notas">{viewing.notes}</SheetRow>}
          {loadedBy.nameOf(viewing.user_id) && <SheetRow label="Lo cargó">{loadedBy.nameOf(viewing.user_id)}</SheetRow>}
        </EntrySheet>
      )}

      {showForm && (
        <FormSheet
          title={form.op_type === "initial" ? "Tenencia inicial" : editId ? "Editar operación" : "Nueva operación"}
          onClose={closeForm}
        >
          <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
            <div className={FORM_SHEET_BODY}>
              {form.op_type !== "initial" && (
                <SegmentedToggle
                  ariaLabel="Tipo de operación"
                  value={form.op_type as "buy" | "sell" | "adjustment"}
                  onChange={t => setForm(p => ({ ...p, op_type: t }))}
                  options={(["buy", "sell", "adjustment"] as const).map(t => ({ value: t, label: OP_LABELS[t] }))}
                />
              )}

              <AmountField
                label={form.op_type === "buy" ? "Dólares que compré"
                  : form.op_type === "sell" ? "Dólares que vendí"
                  : form.op_type === "initial" ? "Dólares que tenías"
                  : "Dólares"}
                currency="USD"
                toggle={form.op_type === "adjustment" ? (
                  <SegmentedToggle
                    ariaLabel="Sentido del ajuste" className="w-[132px]"
                    value={form.adjustSign}
                    onChange={v => setForm(p => ({ ...p, adjustSign: v }))}
                    options={[{ value: "+", label: "Suma" }, { value: "-", label: "Resta" }]}
                  />
                ) : undefined}
                value={form.usd}
                onChange={e => setForm(p => syncAmounts({ ...p, usd: e.target.value }, "usd"))}
                required
              />

              {form.op_type === "initial" && (
                <p className="px-1.5 text-sm leading-snug text-[#4A4658]">
                  Los dólares que ya tenías a esta fecha. Los consumos en dólares anteriores a ella no se
                  descuentan: ya están reflejados en este número.
                </p>
              )}
              {form.op_type === "buy" && (
                <p className="px-1.5 text-sm leading-snug text-[#4A4658]">
                  No es un egreso: los pesos no se gastan, cambian de moneda. No entra en tus categorías
                  de gastos, pero sí descuenta de los pesos disponibles del mes.
                </p>
              )}

              {showConverter && (
                <>
                  {Object.values(rates).some(v => v > 0) && (
                    <ChoiceChips
                      ariaLabel="Cotización del día"
                      value={form.rate_type}
                      onChange={type => setForm(p => syncAmounts({ ...p, rate: amountText(rates[type]), rate_type: type }, "rate"))}
                      options={Object.entries(rates).filter(([, v]) => v > 0).map(([type, value]) => ({
                        value: type,
                        label: `${RATE_TYPE_LABELS[type]} ${Math.round(value).toLocaleString("es-AR")}`,
                      }))}
                    />
                  )}
                  <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
                    <div>
                      <label className={LABEL}>Cotización ($ por U$D)</label>
                      <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={`${FIELD} tabular-nums`}
                        aria-label="Cotización"
                        value={form.rate}
                        onChange={e => setForm(p => syncAmounts({ ...p, rate: e.target.value, rate_type: "personalizado" }, "rate"))}
                        required={hasArsLeg} />
                    </div>
                    <div>
                      <label className={LABEL}>
                        {form.op_type === "buy" ? "Pesos que pagué"
                          : form.op_type === "sell" ? "Pesos que recibí"
                          : "Equivalente en pesos"}
                      </label>
                      <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={`${FIELD} tabular-nums`}
                        aria-label="Pesos"
                        value={form.ars}
                        onChange={e => setForm(p => syncAmounts({ ...p, ars: e.target.value }, "ars"))}
                        required={hasArsLeg} />
                    </div>
                  </div>
                  {!hasArsLeg && (
                    <p className="px-1.5 text-sm leading-snug text-[#4A4658]">
                      Sólo para calcular los dólares. Un ajuste no mueve pesos, así que no se guarda ni afecta tu balance.
                    </p>
                  )}
                </>
              )}

              <div>
                <label className={LABEL}>Fecha</label>
                <DateField required value={form.operation_date}
                  onChange={v => setForm(p => ({ ...p, operation_date: v }))} />
              </div>

              {hasArsLeg && (
                <div>
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <label className={LABEL}>Entidad (opcional)</label>
                    <SegmentedToggle
                      ariaLabel="Tipo de entidad" className="w-[190px]"
                      value={form.entityMode}
                      onChange={mode => setForm(p => ({ ...p, entityMode: mode, entity: "" }))}
                      options={[{ value: "banco", label: "Banco" }, { value: "personalizado", label: "Personalizado" }]}
                    />
                  </div>
                  {form.entityMode === "banco" ? (
                    <SelectField value={form.entity}
                      onChange={v => setForm(p => ({ ...p, entity: v }))}
                      placeholder="Sin especificar"
                      options={ARGENTINE_BANKS.map(b => ({ value: b.name, label: b.name }))} />
                  ) : (
                    <input className={FIELD} placeholder="Broker, cueva, persona..." aria-label="Entidad"
                      value={form.entity}
                      onChange={e => setForm(p => ({ ...p, entity: e.target.value }))} />
                  )}
                </div>
              )}

              <div>
                <label className={LABEL}>Notas (opcional)</label>
                <input className={FIELD} aria-label="Notas" value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>

              {formError && <p role="alert" className="px-1.5 text-sm text-destructive">{formError}</p>}
            </div>
            <FormSheetActions onCancel={closeForm} saving={saving} label="Guardar operación" />
          </form>
        </FormSheet>
      )}
    </div>
  );
}
