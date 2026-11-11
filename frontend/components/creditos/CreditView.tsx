"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown, ChevronLeft, Loader2, MoreVertical, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, getErrorMessage, parseAmount } from "@/lib/utils";
import { DateField } from "@/components/ui/form";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import { MotionList } from "@/components/ui/motion-list";
import { BLOCK, GLASS } from "@/components/ui/glass";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { EntrySheet, SheetActions, SheetRow } from "@/components/movimientos/EntrySheet";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { LedgerRow, ledgerAmount } from "@/components/movimientos/Ledger";
import { CreditForm } from "./CreditForm";
import {
  AMORTIZATION_TEXT, H1, MENU_ITEM, MENU_PANEL, OPTION,
  adjustmentText, fmtDate, fmtDecimal, methodText, money, monthName, paymentDate,
  type Credit, type CreditDetail, type CreditPayment,
} from "./shared";

/** Las últimas cuotas a la vista; las demás, detrás de un toque. */
const PAYMENTS_SHOWN = 12;

/**
 * Un crédito entero: la próxima cuota en el bloque violeta, el detalle detrás de
 * "Ver detalle" y las cuotas registradas. Es la pantalla `/creditos/[id]`, y
 * también `/creditos` cuando hay uno solo activo (`embedded`), que se ve como la
 * Hipoteca de antes.
 */
/** El alta va arriba, al lado del ⋮, igual que "+ Objetivo" en Objetivos. */
export function AddCreditButton({ onClick }: { onClick: () => void }) {
  return (
    // En el celular el alta va por el + de la barra: acá arriba quedaba tapado por el encabezado.
    <button onClick={onClick} data-tour="creditos-add"
      className="hidden md:inline-flex h-11 pl-3.5 pr-4 rounded-full bg-ink text-background text-[14.5px] font-semibold items-center gap-1.5 active:scale-[0.97] transition-transform duration-100">
      <Plus className="w-[18px] h-[18px]" /> Crédito
    </button>
  );
}

export function CreditView({ id, initial, embedded = false, onChanged, onDeleted, onAdd, tour }: {
  id: number;
  initial?: Credit;
  embedded?: boolean;
  /** Algo cambió: la lista de arriba se vuelve a pedir. */
  onChanged?: () => void;
  onDeleted: () => void;
  /** Sólo en `/creditos`: agregar otro. */
  onAdd?: () => void;
  /** La guía, que se monta recién con el crédito y sus cuotas en pantalla. */
  tour?: (credit: Credit, hasPayments: boolean) => React.ReactNode;
}) {
  useAmountsHidden();  // repinta al ocultar/mostrar montos
  const reaccionar = useReaccion();
  const [credit, setCredit] = useState<Credit | null>(initial ?? null);
  const [payments, setPayments] = useState<CreditPayment[] | null>(null);
  const [failed, setFailed] = useState<"error" | "missing" | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [viewing, setViewing] = useState<CreditPayment | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<CreditDetail>(`/credits/${id}`);
      setCredit(data.credit);
      setPayments(data.payments);
      setFailed(null);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setFailed(status === 404 ? "missing" : "error");
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); onChanged?.(); };

  const patch = async (body: Record<string, unknown>, text: string) => {
    if (!credit) return;
    setBusy(true);
    try {
      const { data } = await api.patch<Credit>(`/credits/${credit.id}`, body);
      setCredit(data);
      changed();
      reaccionar("guardado", text);
    } catch (err) {
      reaccionar("error", getErrorMessage(err, "No se pudo guardar. Probá de nuevo."));
    } finally { setBusy(false); }
  };

  const deletePayment = async (p: CreditPayment) => {
    try {
      await api.delete(`/credits/payments/${p.id}`);
      setViewing(null);
      changed();
      reaccionar("borrado", "Cuota eliminada");
    } catch (err) {
      reaccionar("error", getErrorMessage(err, "No se pudo eliminar la cuota. Probá de nuevo."));
    }
  };

  if (failed === "missing") {
    return (
      <div className="space-y-4">
        <Header title="Créditos" embedded={embedded} />
        <section className="px-2 pt-2">
          <p className="text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground">Ese crédito ya no está</p>
          <p className="mt-1 text-[15.5px] leading-snug text-muted-foreground">Puede que lo hayan eliminado desde otro dispositivo.</p>
          <Link href="/creditos" className="mt-4 inline-flex items-center h-[52px] px-6 rounded-full bg-ink text-background font-semibold text-[15.5px]">
            Ver mis créditos
          </Link>
        </section>
      </div>
    );
  }

  if (!credit) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Header title="Créditos" embedded={embedded} />
        {failed ? <LoadError onRetry={load} /> : (
          <div className={`${BLOCK} h-[220px] animate-pulse`}><span className="sr-only">Cargando el crédito</span></div>
        )}
      </div>
    );
  }

  const c = credit;
  const isUva = c.adjustment === "uva";
  const isManual = c.method === "manual";
  const isPlan = c.kind === "plan_ahorro";
  const live = c.is_active && !c.finished;
  const shownPayments = payments ? (showAll ? payments : payments.slice(0, PAYMENTS_SHOWN)) : [];

  const detailRows = [
    ["Tipo", c.kind_label],
    ["Cómo se ajusta", adjustmentText(c)],
    c.method === "formula" ? ["Sistema", AMORTIZATION_TEXT[c.amortization].label] : null,
    ["Cuota", methodText(c.method)],
    c.tna != null && c.method === "formula" ? ["TNA", `${fmtDecimal(c.tna)}%`] : null,
    c.capital != null && Number(c.capital) > 0 ? ["Capital", isUva ? formatARS(c.capital) : money(c.capital, c.currency)] : null,
    isUva && c.original_capital_uva ? ["Capital en UVA", fmtDecimal(c.original_capital_uva)] : null,
    isUva && c.cuota_uva && c.method === "cuota" ? ["Cuota en UVA", fmtDecimal(c.cuota_uva)] : null,
    ["Primera cuota", format(parseISO(c.first_payment_date), "MMMM yyyy", { locale: es })],
    ["Día de pago", c.payment_day != null ? `Día ${c.payment_day}` : "Primer día hábil"],
    c.next_amount && live ? ["Cuota exacta", money(c.next_amount, c.currency)] : null,
    isUva && c.uva_value ? [`UVA al ${c.uva_date ? fmtDate(c.uva_date) : "último dato"}`, formatARS(c.uva_value)] : null,
    c.loan_number ? [isPlan ? "Grupo y orden" : "N° de préstamo", c.loan_number] : null,
  ].filter((row): row is string[] => !!row);

  const hasBalance = c.balance != null && Number(c.balance) > 0;
  const hasPaid = Number(c.total_paid) > 0;
  const restantes = c.cuotas_restantes;

  return (
    <div className="space-y-4 md:space-y-6">
      <Header
        title={embedded ? "Créditos" : c.title}
        sub={embedded ? c.title : c.title !== c.kind_label ? c.kind_label : undefined}
        embedded={embedded}
        menu={
          <div className="flex items-center gap-0.5 shrink-0">
          {onAdd && <AddCreditButton onClick={onAdd} />}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button title="Más acciones" aria-label="Más acciones" data-tour="creditos-menu"
                className="w-11 h-11 -mr-2 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none">
                <MoreVertical className="w-5 h-5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className={MENU_PANEL}>
                <DropdownMenu.Item asChild><PrivacyMenuItem /></DropdownMenu.Item>
                <DropdownMenu.Item asChild>
                  <button onClick={() => setEditing(true)} className={`${MENU_ITEM} text-foreground`}>
                    <Pencil className="w-4 h-4 text-muted-foreground" /> Editar crédito
                  </button>
                </DropdownMenu.Item>
                {!c.finished && (
                  <DropdownMenu.Item asChild>
                    <button disabled={busy}
                      onClick={() => patch({ is_active: !c.is_active }, c.is_active ? "Crédito pausado" : "Crédito reactivado")}
                      className={`${MENU_ITEM} text-foreground`}>
                      {c.is_active
                        ? <><Pause className="w-4 h-4 text-muted-foreground" /> Pausar crédito</>
                        : <><Play className="w-4 h-4 text-muted-foreground" /> Reactivar crédito</>}
                    </button>
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Separator className="h-px bg-border my-1" />
                <DropdownMenu.Item asChild>
                  <button onClick={() => setDeleting(true)} className={`${MENU_ITEM} text-destructive`}>
                    <Trash2 className="w-4 h-4" /> Eliminar crédito
                  </button>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          </div>
        }
      />

      {failed === "error" && <LoadError onRetry={load} />}
      {tour && payments && tour(c, payments.length > 0)}

      <section className={BLOCK} data-tour="creditos-figure">
        <div className="px-2.5">
          <p className="text-[16.5px] font-medium">
            {c.finished ? "Terminado" : !c.is_active ? "Pausado" : `Cuota ${c.cuota_numero} de ${c.total_cuotas}`}
          </p>
          {c.finished ? (
            <p className="mt-1 text-[22px] font-medium leading-tight tracking-[-0.025em]">Pagaste las {c.total_cuotas} cuotas.</p>
          ) : isManual ? (
            <p className="mt-1 text-[22px] font-medium leading-tight tracking-[-0.025em]">
              {isPlan ? "La cuota sigue el precio del bien: la cargás cada mes." : "La cuota la cargás cada mes."}
            </p>
          ) : c.next_amount ? (
            <p className="font-medium leading-[1.08] tracking-[-0.045em] tabular-nums text-[clamp(2.5rem,13vw,3.5rem)]">
              {money(c.next_amount, c.currency, true)}
            </p>
          ) : isUva ? (
            <p className="mt-1 text-[22px] font-medium leading-tight tracking-[-0.025em]">
              Todavía no hay valor de la UVA para pasar la cuota a pesos.
            </p>
          ) : null}
          {isUva && c.next_units && !c.finished && (
            <p className="mt-1.5 text-[15.5px] leading-snug tabular-nums">
              {fmtDecimal(c.next_units)} UVA{c.next_is_estimated && c.next_amount ? " · estimada con la última UVA" : ""}
            </p>
          )}

          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(c.pct_completado, 100)}
            aria-label="Cuotas pagadas" className="mt-3.5 h-2 rounded-full bg-[rgba(20,14,70,0.32)] overflow-hidden">
            <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(c.pct_completado, 100)}%` }} />
          </div>
          <p className="mt-1.5 text-sm">
            {restantes > 0 ? `${restantes} ${restantes === 1 ? "restante" : "restantes"} · ` : ""}
            {Number(c.pct_completado).toLocaleString("es-AR", { maximumFractionDigits: 1 })}% de las cuotas
          </p>

          {isManual && live && (
            <button onClick={() => setPaying(true)} data-tour="creditos-pay"
              className="mt-3.5 h-[52px] w-full sm:w-auto sm:px-8 rounded-full bg-white text-[#352A9E] font-semibold text-[15.5px] inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform duration-100">
              <Plus className="w-[18px] h-[18px]" /> Cargar cuota
            </button>
          )}
        </div>

        <MotionList className={`mt-3.5 ${GLASS}`}>
          <div className="px-4 pt-3 pb-1 text-[15px] leading-snug">
            {c.finished ? (
              <p className="font-semibold">No quedan cuotas por pagar.</p>
            ) : c.paid_this_month ? (
              <>
                <p className="font-semibold">Cuota de {format(new Date(), "MMMM", { locale: es })} registrada</p>
                {c.next_payment_date && <p>Próxima: {fmtDate(c.next_payment_date)}</p>}
              </>
            ) : (
              <>
                {c.next_payment_date && <p className="font-semibold">Próxima cuota: {fmtDate(c.next_payment_date)}</p>}
                <p>
                  {!c.is_active ? "Está pausado: las cuotas no se registran solas."
                    : isManual ? "Cargala cuando la pagues, y queda con su egreso."
                    : "Se registra sola, con su egreso."}
                </p>
              </>
            )}
          </div>

          {isPlan && (
            <div className="px-4 py-2 flex items-center justify-between gap-3 text-[15px]">
              <span>Plan {c.plan_status === "adjudicado" ? "adjudicado" : "suscripto"}</span>
              <button disabled={busy}
                onClick={() => patch(
                  { plan_status: c.plan_status === "adjudicado" ? "suscripto" : "adjudicado" },
                  c.plan_status === "adjudicado" ? "Plan suscripto" : "Plan adjudicado",
                )}
                className="min-h-[40px] px-3.5 rounded-full bg-white/15 border border-white/25 text-sm font-semibold disabled:opacity-60">
                {c.plan_status === "adjudicado" ? "Volver a suscripto" : "Ya me lo adjudicaron"}
              </button>
            </div>
          )}

          {(hasBalance || hasPaid) && (
            <div className="px-4 py-1 text-[15px]">
              {hasBalance && (
                <div className="flex items-baseline justify-between gap-4 py-1.5">
                  <span>Saldo pendiente</span>
                  <span className="tabular-nums text-right font-semibold">
                    {money(c.balance!, c.currency)}
                    {isUva && c.balance_units && <span className="block text-sm font-normal">{fmtDecimal(c.balance_units)} UVA</span>}
                  </span>
                </div>
              )}
              {hasPaid && (
                <div className="flex items-baseline justify-between gap-4 py-1.5">
                  <span>Pagado hasta hoy</span>
                  <span className="tabular-nums text-right font-semibold">{money(c.total_paid, c.currency)}</span>
                </div>
              )}
            </div>
          )}

          <button onClick={() => setShowDetail(v => !v)} aria-expanded={showDetail} data-tour="creditos-detail"
            className="w-full min-h-[44px] px-4 flex items-center justify-between gap-3 text-[15px] font-medium">
            {showDetail ? "Ver menos" : "Ver detalle"}
            <ChevronDown className={`w-[18px] h-[18px] transition-transform ${showDetail ? "rotate-180" : ""}`} />
          </button>
          {showDetail && (
            <div className="px-4 pb-1 divide-y divide-white/[0.18] border-t border-white/[0.18] text-[15px]">
              {detailRows.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="min-w-0">{label}</span>
                  <span className="tabular-nums text-right first-letter:uppercase">{value}</span>
                </div>
              ))}
            </div>
          )}
        </MotionList>
      </section>

      {payments && payments.length > 0 && (
        <section className="px-2" data-tour="creditos-cuotas">
          <h2 className="mb-1 text-[22px] font-medium tracking-[-0.03em] text-foreground">Cuotas registradas</h2>
          <MotionList>
            {shownPayments.map(p => {
              const bits = [
                isUva && p.uva_units && Number(p.uva_units) > 0 ? `${fmtDecimal(p.uva_units)} UVA` : null,
                p.is_manual ? "Cargada a mano" : null,
              ].filter(Boolean).join(" · ");
              return (
                <LedgerRow key={p.id}
                  date={paymentDate(p)}
                  title={p.cuota_number ? `Cuota ${p.cuota_number} de ${c.total_cuotas}` : `Cuota de ${monthName(p.period_date)}`}
                  sub={bits || undefined}
                  amount={ledgerAmount(p.payment_amount, p.currency)}
                  onOpen={() => setViewing(p)}
                />
              );
            })}
          </MotionList>
          {payments.length > PAYMENTS_SHOWN && (
            <button onClick={() => setShowAll(v => !v)} aria-expanded={showAll}
              className="mt-1 min-h-[44px] px-1 inline-flex items-center gap-1.5 text-[15px] font-medium text-[#3B2FB3]">
              {showAll ? "Ver menos" : `Ver las ${payments.length} cuotas`}
              <ChevronDown className={`w-[18px] h-[18px] transition-transform ${showAll ? "rotate-180" : ""}`} />
            </button>
          )}
        </section>
      )}

      {payments && payments.length === 0 && isManual && live && (
        <p className="px-2 text-[15px] leading-snug text-muted-foreground">
          Todavía no cargaste ninguna cuota. Cuando pagues una, tocá Cargar cuota.
        </p>
      )}

      {viewing && (
        <PaymentSheet payment={viewing} credit={c}
          onClose={() => setViewing(null)}
          onDelete={viewing.is_manual ? () => deletePayment(viewing) : undefined} />
      )}

      {paying && (
        <PaymentForm credit={c} onClose={() => setPaying(false)}
          onSaved={() => { changed(); reaccionar("guardado", "Cuota cargada"); }} />
      )}

      {editing && (
        <CreditForm edit={c} onClose={() => setEditing(false)}
          onSaved={data => { setCredit(data); changed(); reaccionar("guardado", "Crédito guardado"); }} />
      )}

      {deleting && (
        <DeleteCreditSheet credit={c} onClose={() => setDeleting(false)}
          onDeleted={() => { reaccionar("borrado", "Crédito eliminado"); onDeleted(); }} />
      )}
    </div>
  );
}

function Header({ title, sub, embedded, menu }: { title: string; sub?: string; embedded: boolean; menu?: React.ReactNode }) {
  return (
    <div>
      {!embedded && (
        <Link href="/creditos" className="-ml-1.5 mb-0.5 inline-flex items-center gap-0.5 min-h-[36px] pr-2 text-sm font-medium text-[#3B2FB3]">
          <ChevronLeft className="w-4 h-4" /> Créditos
        </Link>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className={`${H1} truncate`}>{title}</h1>
          {sub && <p className="text-sm text-muted-foreground truncate">{sub}</p>}
        </div>
        {menu}
      </div>
    </div>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] text-rose-900">
      <p>No pudimos traer tus créditos. Tus datos están bien: fijate si tenés conexión.</p>
      <button onClick={onRetry} className="mt-1 min-h-[36px] font-semibold underline">Probar de nuevo</button>
    </div>
  );
}

// ── La ficha de una cuota ──────────────────────────────────────────────────────

/** Una cuota registrada no se edita: la que cargó la persona se borra, la que registró la app no. */
function PaymentSheet({ payment: p, credit, onClose, onDelete }: {
  payment: CreditPayment;
  credit: Credit;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const hasUnits = credit.adjustment === "uva" && p.uva_units != null && Number(p.uva_units) > 0;
  return (
    <EntrySheet date={paymentDate(p)}
      title={p.cuota_number ? `Cuota ${p.cuota_number} de ${credit.total_cuotas}` : `Cuota de ${monthName(p.period_date)}`}
      badge={{ label: credit.title }}
      amount={money(p.payment_amount, p.currency)}
      onClose={onClose}
      footer={onDelete ? <SheetActions question="¿Eliminar esta cuota? Se borra también su egreso." onDelete={onDelete} /> : undefined}>
      {hasUnits && <SheetRow label="UVA"><span className="tabular-nums">{fmtDecimal(p.uva_units)}</span></SheetRow>}
      {p.capital != null && Number(p.capital) > 0 && (
        <SheetRow label="Capital"><span className="tabular-nums">{money(p.capital, p.currency)}</span></SheetRow>
      )}
      {p.interest != null && Number(p.interest) > 0 && (
        <SheetRow label="Interés"><span className="tabular-nums">{money(p.interest, p.currency)}</span></SheetRow>
      )}
      {p.is_manual && <SheetRow label="Origen">Cargada a mano</SheetRow>}
    </EntrySheet>
  );
}

// ── Cargar una cuota a mano ────────────────────────────────────────────────────

function PaymentForm({ credit, onClose, onSaved }: { credit: Credit; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseAmount(amount);
    if (!amount.trim() || !(n > 0)) { setError("Decime cuánto pagaste."); return; }
    if (!paidOn) { setError("Elegí el día en que la pagaste."); return; }
    setError("");
    setSaving(true);
    try {
      await api.post(`/credits/${credit.id}/payments`, { amount: n, paid_on: paidOn });
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo cargar la cuota. Probá de nuevo."));
    } finally { setSaving(false); }
  };

  return (
    <FormSheet title="Cargar cuota" onClose={onClose}>
      <form onSubmit={handleSave} className={FORM_SHEET_FORM} noValidate>
        <div className={FORM_SHEET_BODY}>
          <AmountField label={`Cuota de ${credit.title}`} currency={credit.currency} autoFocus
            value={amount} onChange={e => setAmount(e.target.value)} />
          <div>
            <label className="text-xs font-medium text-muted-foreground">Cuándo la pagaste</label>
            <DateField value={paidOn} onChange={setPaidOn} required />
          </div>
          <p className="px-1.5 text-sm leading-snug text-[#4A4658]">
            Se registra como la cuota de ese mes, con su egreso.
          </p>
          {error && <p role="alert" className="px-1.5 text-sm text-destructive">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Cargar cuota" />
      </form>
    </FormSheet>
  );
}

// ── Eliminar un crédito ────────────────────────────────────────────────────────

function DeleteCreditSheet({ credit, onClose, onDeleted }: { credit: Credit; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async (keepHistory: boolean) => {
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/credits/${credit.id}?keep_history=${keepHistory}`);
      onClose();
      onDeleted();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo eliminar el crédito. Probá de nuevo."));
      setDeleting(false);
    }
  };

  return (
    <FormSheet title="Eliminar crédito" onClose={onClose}>
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 space-y-2">
        <p className="px-1.5 pb-1 text-[15px] text-[#4A4658]">¿Qué querés hacer con las cuotas que ya se registraron?</p>
        <button type="button" disabled={deleting} onClick={() => handleDelete(true)} className={OPTION}>
          <span className="block text-[15.5px] font-semibold text-foreground">Mantener el historial</span>
          <span className="block mt-0.5 text-sm leading-snug text-[#4A4658]">
            Se borra el crédito, pero las cuotas pagadas y sus egresos quedan.
          </span>
        </button>
        <button type="button" disabled={deleting} onClick={() => handleDelete(false)} className={OPTION}>
          <span className="block text-[15.5px] font-semibold text-destructive">Eliminar todo</span>
          <span className="block mt-0.5 text-sm leading-snug text-[#4A4658]">
            Se borran el crédito, sus cuotas y los egresos que se registraron con ellas.
          </span>
        </button>
        {deleting && (
          <p className="flex items-center gap-2 px-1.5 text-sm text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Eliminando…
          </p>
        )}
        {error && <p role="alert" className="px-1.5 text-sm text-destructive">{error}</p>}
      </div>
    </FormSheet>
  );
}
