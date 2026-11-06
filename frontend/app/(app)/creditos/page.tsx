"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { Step } from "react-joyride";
import { ChevronDown, Landmark, MoreVertical, Plus } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARSRound, formatUSD } from "@/lib/utils";
import ProductTour from "@/components/ProductTour";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import { MotionList } from "@/components/ui/motion-list";
import { BLOCK, GLASS } from "@/components/ui/glass";
import { EntrySheet, SheetRow } from "@/components/movimientos/EntrySheet";
import { LedgerRow, ledgerAmount } from "@/components/movimientos/Ledger";
import { CreditForm } from "@/components/creditos/CreditForm";
import { CreditView, LoadError } from "@/components/creditos/CreditView";
import {
  H1, MENU_ITEM, MENU_PANEL, creditSub, fmtDecimal, fmtShortDate, isCurrentMonth, money, monthName,
  type Credit,
} from "@/components/creditos/shared";

/** Una cuota que quedó suelta al borrar su crédito con "Mantener el historial". */
interface LooseRecord {
  id: number;
  period_date: string;
  payment_amount: string | number;
  capital: string | number | null;
  interest: string | number | null;
  uva_units: string | number | null;
  mortgage_loan_id: number | null;
}

// Muestra lo que hay en la pantalla, en el orden en que se mira.
const singleTour = (c: Credit, hasPayments: boolean): Step[] => [
  {
    target: "[data-tour='creditos-figure']",
    title: c.method === "manual" ? "Tu crédito" : "La próxima cuota",
    content: c.method === "manual"
      ? "Cuántas cuotas van y cuántas faltan. Cuando pagues una, la cargás desde acá."
      : "Cuánto vas a pagar y cuántas cuotas faltan. En Ver detalle están la tasa, el sistema y el día de pago.",
  },
  ...(hasPayments ? [{
    target: "[data-tour='creditos-cuotas']",
    title: "Cuotas registradas",
    content: c.method === "manual"
      ? "Las que cargaste, cada una con su egreso. Tocá una para ver el detalle o borrarla."
      : "Cada mes la cuota se registra sola, con su egreso en Movimientos. Tocá una para ver su detalle.",
  }] : []),
  {
    target: "[data-tour='creditos-add']",
    title: "Otro crédito",
    content: "Un préstamo personal, un prendario, un plan de ahorro o plata que te prestó alguien.",
  },
];

const listTour: Step[] = [
  {
    target: "[data-tour='creditos-figure']",
    title: "Lo que sale en cuotas",
    content: "La suma de las cuotas de este mes. Lo que está en dólares va aparte, sin mezclarlo con los pesos.",
  },
  {
    target: "[data-tour='creditos-list']",
    title: "Cada crédito",
    content: "Tocá uno para ver sus cuotas, el saldo y lo que ya pagaste.",
  },
  {
    target: "[data-tour='creditos-add']",
    title: "Otro crédito",
    content: "Un préstamo personal, un prendario, un plan de ahorro o plata que te prestó alguien.",
  },
];

export default function CreditosPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const router = useRouter();
  const [credits, setCredits] = useState<Credit[] | null>(null);
  const [loose, setLoose] = useState<LooseRecord[]>([]);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const [showLoose, setShowLoose] = useState(false);
  const [viewingLoose, setViewingLoose] = useState<LooseRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Credit[]>("/credits");
      setCredits(data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    // El historial suelto es un extra: si falla, la pantalla sigue.
    api.get<LooseRecord[]>("/mortgage")
      .then(({ data }) => setLoose(data.filter(r => r.mortgage_loan_id == null)))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const addButton = (
    <button onClick={() => setAdding(true)} data-tour="creditos-add"
      className="h-[52px] px-6 rounded-full bg-ink text-background font-semibold text-[15.5px] inline-flex items-center gap-2 active:scale-[0.98] transition-transform duration-100">
      <Plus className="w-[18px] h-[18px]" /> {credits && credits.length > 0 ? "Agregar otro crédito" : "Agregar crédito"}
    </button>
  );

  const form = adding && (
    <CreditForm edit={null} onClose={() => setAdding(false)}
      onSaved={() => { load(); }} />
  );

  if (!credits) {
    return (
      <div className="space-y-4" aria-busy={!failed}>
        <h1 className={H1}>Créditos</h1>
        {failed ? <LoadError onRetry={load} /> : (
          <div className={`${BLOCK} h-[220px] animate-pulse`}><span className="sr-only">Cargando tus créditos</span></div>
        )}
      </div>
    );
  }

  const live = credits.filter(c => c.is_active && !c.finished);
  const old = credits.filter(c => !c.is_active || c.finished);

  const extras = (
    <>
      {old.length > 0 && (
        <section className="px-2">
          <button onClick={() => setShowOld(v => !v)} aria-expanded={showOld}
            className="w-full min-h-[44px] flex items-center justify-between gap-3 text-[17px] font-medium tracking-[-0.02em] text-foreground">
            Terminados o pausados ({old.length})
            <ChevronDown className={`w-[18px] h-[18px] text-muted-foreground transition-transform ${showOld ? "rotate-180" : ""}`} />
          </button>
          <MotionList>
            {showOld && old.map(c => <CreditRow key={c.id} credit={c} onOpen={() => router.push(`/creditos/${c.id}`)} />)}
          </MotionList>
        </section>
      )}
      {loose.length > 0 && (
        <section className="px-2">
          <button onClick={() => setShowLoose(v => !v)} aria-expanded={showLoose}
            className="w-full min-h-[44px] flex items-center justify-between gap-3 text-left text-[17px] font-medium tracking-[-0.02em] text-foreground">
            Cuotas de créditos que eliminaste ({loose.length})
            <ChevronDown className={`w-[18px] h-[18px] shrink-0 text-muted-foreground transition-transform ${showLoose ? "rotate-180" : ""}`} />
          </button>
          <MotionList>
            {showLoose && loose.map(r => (
              <LedgerRow key={r.id} date={r.period_date}
                title={`Cuota de ${monthName(r.period_date)}`}
                sub={r.uva_units && Number(r.uva_units) > 0 ? `${fmtDecimal(r.uva_units)} UVA` : undefined}
                amount={ledgerAmount(r.payment_amount)}
                onOpen={() => setViewingLoose(r)} />
            ))}
          </MotionList>
        </section>
      )}
      {viewingLoose && (
        <EntrySheet date={viewingLoose.period_date} title={`Cuota de ${format(parseISO(viewingLoose.period_date), "MMMM yyyy", { locale: es })}`}
          amount={money(viewingLoose.payment_amount, "ARS")} onClose={() => setViewingLoose(null)}>
          {viewingLoose.uva_units != null && Number(viewingLoose.uva_units) > 0 && (
            <SheetRow label="UVA"><span className="tabular-nums">{fmtDecimal(viewingLoose.uva_units)}</span></SheetRow>
          )}
          {viewingLoose.capital != null && Number(viewingLoose.capital) > 0 && (
            <SheetRow label="Capital"><span className="tabular-nums">{money(viewingLoose.capital, "ARS")}</span></SheetRow>
          )}
          {viewingLoose.interest != null && Number(viewingLoose.interest) > 0 && (
            <SheetRow label="Interés"><span className="tabular-nums">{money(viewingLoose.interest, "ARS")}</span></SheetRow>
          )}
          <SheetRow label="Crédito">Eliminado</SheetRow>
        </EntrySheet>
      )}
    </>
  );

  // ── Uno solo activo: se ve como la Hipoteca de antes ─────────────────────────
  if (live.length === 1) {
    const only = live[0];
    return (
      <div className="space-y-4 md:space-y-6">
        <CreditView key={only.id} id={only.id} initial={only} embedded
          onChanged={load} onDeleted={load} onAdd={() => setAdding(true)}
          tour={(c, hasPayments) => <ProductTour tourId="creditos-intro" steps={singleTour(c, hasPayments)} />} />
        <div className="px-2">{addButton}</div>
        {extras}
        {form}
      </div>
    );
  }

  const header = (
    <div className="flex items-center justify-between gap-2">
      <h1 className={H1}>Créditos</h1>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button title="Más acciones" aria-label="Más acciones"
            className="w-11 h-11 -mr-2 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none">
            <MoreVertical className="w-5 h-5" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className={MENU_PANEL}>
            <DropdownMenu.Item asChild><PrivacyMenuItem /></DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <button onClick={() => setAdding(true)} className={`${MENU_ITEM} text-foreground`}>
                <Plus className="w-4 h-4 text-muted-foreground" /> Agregar crédito
              </button>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );

  // ── Ninguno activo ───────────────────────────────────────────────────────────
  if (live.length === 0) {
    return (
      <div className="space-y-4 md:space-y-6">
        {header}
        {failed && <LoadError onRetry={load} />}
        <section className="px-2 pt-2">
          <Landmark className="w-8 h-8 text-[#3B2FB3]" strokeWidth={1.6} aria-hidden="true" />
          <p className="mt-3 text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground">
            {old.length > 0 ? "No tenés créditos activos" : "Todavía no cargaste ningún crédito"}
          </p>
          <p className="mt-1 text-[15.5px] leading-snug text-muted-foreground">
            Una hipoteca, un préstamo personal, un prendario, un plan de ahorro o plata que te prestó alguien.
            Lo cargás una vez y cada mes la cuota se registra sola, con su egreso.
          </p>
          <div className="mt-4">{addButton}</div>
        </section>
        {extras}
        {form}
      </div>
    );
  }

  // ── Varios: lo que sale este mes, y una fila por crédito ─────────────────────
  // Por moneda: nunca se suman pesos con dólares.
  const month = { ARS: { paid: 0, due: 0 }, USD: { paid: 0, due: 0 } };
  let manualDue = 0;
  let nextDue: string | null = null;
  for (const c of live) {
    if (c.paid_this_month) {
      month[c.currency].paid += Number(c.this_month_paid);
    } else if (isCurrentMonth(c.next_payment_date)) {
      if (c.method === "manual" || !c.next_amount) manualDue += 1;
      else {
        month[c.currency].due += Number(c.next_amount);
        if (!nextDue || c.next_payment_date! < nextDue) nextDue = c.next_payment_date;
      }
    }
  }
  const arsTotal = month.ARS.paid + month.ARS.due;
  const usdTotal = month.USD.paid + month.USD.due;
  const hasPaid = month.ARS.paid + month.USD.paid > 0;
  const hasDue = month.ARS.due + month.USD.due > 0;
  const splitRows = (hasPaid && hasDue) || manualDue > 0;
  const monthLabel = format(new Date(), "MMMM", { locale: es });
  const pair = (ars: number, usd: number) =>
    [ars > 0 ? formatARSRound(ars) : null, usd > 0 ? formatUSD(usd).replace(/,00$/, "") : null].filter(Boolean).join(" y ");

  return (
    <div className="space-y-4 md:space-y-6">
      {header}
      {failed && <LoadError onRetry={load} />}
      <ProductTour tourId="creditos-intro" steps={listTour} />

      <section className={BLOCK} data-tour="creditos-figure">
        <div className="px-2.5">
          <p className="text-[16.5px] font-medium first-letter:uppercase">Cuotas de {monthLabel}</p>
          {arsTotal > 0 || usdTotal > 0 ? (
            <>
              {arsTotal > 0 && (
                <p className="font-medium leading-[1.08] tracking-[-0.045em] tabular-nums text-[clamp(2.5rem,13vw,3.5rem)]">
                  {formatARSRound(arsTotal)}
                </p>
              )}
              {usdTotal > 0 && (
                <p className={`font-medium tabular-nums tracking-[-0.03em] ${arsTotal > 0 ? "mt-0.5 text-[22px]" : "leading-[1.08] tracking-[-0.045em] text-[clamp(2.5rem,13vw,3.5rem)]"}`}>
                  {arsTotal > 0 ? "y " : ""}{formatUSD(usdTotal).replace(/,00$/, "")}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-[22px] font-medium leading-tight tracking-[-0.025em]">
              {manualDue > 0 ? "Este mes las cuotas las cargás vos." : "Este mes no vence ninguna cuota."}
            </p>
          )}
          <p className="mt-1.5 text-[15.5px] leading-snug">
            {live.length} créditos activos
            {!splitRows && nextDue ? ` · la próxima, el ${fmtShortDate(nextDue)}` : ""}
            {!splitRows && hasPaid && !hasDue ? " · ya registradas" : ""}
          </p>
        </div>

        {/* Sólo si separa algo: una sola fila repetiría la cifra de arriba. */}
        {splitRows && (
          <div className={`mt-3.5 ${GLASS} px-4 py-2 text-[15px] leading-snug divide-y divide-white/[0.18]`}>
            {month.ARS.paid + month.USD.paid > 0 && (
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <span>Ya registradas</span>
                <span className="tabular-nums text-right font-semibold">{pair(month.ARS.paid, month.USD.paid)}</span>
              </div>
            )}
            {month.ARS.due + month.USD.due > 0 && (
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <span>Por registrar{nextDue ? <span className="block text-sm">La próxima, el {fmtShortDate(nextDue)}</span> : null}</span>
                <span className="tabular-nums text-right font-semibold">{pair(month.ARS.due, month.USD.due)}</span>
              </div>
            )}
            {manualDue > 0 && (
              <p className="py-1.5">
                {manualDue === 1 ? "Una cuota se carga a mano" : `${manualDue} cuotas se cargan a mano`}: entrá al crédito cuando la pagues.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="px-2">
        <h2 className="mb-1 text-[22px] font-medium tracking-[-0.03em] text-foreground">Tus créditos</h2>
        <MotionList data-tour="creditos-list">
          {live.map(c => <CreditRow key={c.id} credit={c} onOpen={() => router.push(`/creditos/${c.id}`)} />)}
        </MotionList>
        <div className="mt-4">{addButton}</div>
      </section>

      {extras}
      {form}
    </div>
  );
}

/** Una fila por crédito: qué es, en qué cuota va, cuánto es la próxima y cuánto falta. */
function CreditRow({ credit: c, onOpen }: { credit: Credit; onOpen: () => void }) {
  const live = c.is_active && !c.finished;
  const amount = live
    ? c.method === "manual" ? null : c.next_amount ? money(c.next_amount, c.currency, true) : null
    : null;
  const right = amount ?? (live && c.method === "manual" ? "A mano" : null);
  return (
    <button type="button" data-no-press onClick={onOpen}
      className="w-full min-h-[72px] py-3 flex flex-col gap-2 text-left border-b border-border last:border-b-0 active:opacity-60 transition-opacity">
      <span className="w-full flex items-center gap-3">
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-[15.5px] text-foreground truncate">{c.title}</span>
          <span className="block text-sm text-muted-foreground truncate">{creditSub(c)}</span>
        </span>
        {right && (
          <span className="shrink-0 text-right">
            <span className={`block tabular-nums font-medium text-base ${amount ? "text-foreground" : "text-muted-foreground"}`}>{right}</span>
            {live && c.next_payment_date && (
              <span className="block font-marca text-xs text-muted-foreground">
                {c.paid_this_month ? "próxima " : ""}{fmtShortDate(c.next_payment_date)}{c.next_is_estimated && amount ? " · estimada" : ""}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="w-full h-1.5 rounded-full bg-ink/[0.08] overflow-hidden" aria-hidden="true">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(c.pct_completado, 100)}%` }} />
      </span>
    </button>
  );
}
