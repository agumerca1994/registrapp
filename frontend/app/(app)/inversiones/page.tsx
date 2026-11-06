"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, MoreVertical, Plus, TrendingUp } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Step } from "react-joyride";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { useReaccion } from "@/components/brand/ToodReaccion";
import ProductTour from "@/components/ProductTour";
import { BLOCK, GLASS } from "@/components/ui/glass";
import { useCountUp } from "@/components/ui/count-up";
import { MotionList } from "@/components/ui/motion-list";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import { InvestmentForm } from "@/components/inversiones/forms";
import {
  H1, MENU_PANEL, TONE, isStale, money, pctText, shortDate, signedMoney, statusLine, subLine,
  type Currency, type Investment, type InvestmentsResponse, type Kind, type Totals,
} from "@/components/inversiones/shared";

/** Lo que se ve en la pantalla, en el orden en que se mira. Sólo con inversiones. */
function tourSteps(hasAlert: boolean): Step[] {
  return [
    {
      target: "[data-tour='inversiones-total']",
      title: "Cuánto vale hoy",
      content: "Lo que valen hoy tus inversiones y cuánto ganaste contra lo que pusiste. Pesos y dólares, cada uno por su lado.",
    },
    ...(hasAlert ? [{
      target: "[data-tour='inversiones-alert']",
      title: "Lo que espera algo",
      content: "Un plazo fijo que venció o un valor viejo. Tocalo para renovarlo, rescatarlo o cargar cuánto vale.",
    }] : []),
    {
      target: "[data-tour='inversiones-item']",
      title: "Cada inversión",
      content: "Cuánto vale y cuánto rinde. Tocala para poner más, sacar o actualizar el valor.",
    },
    {
      target: "[data-tour='inversiones-add']",
      title: "Otra inversión",
      content: "Un plazo fijo, una cuenta remunerada, un fondo, acciones, cripto o efectivo.",
    },
  ];
}

/** La cifra del bloque: los pesos si hay, si no los dólares. Nunca las dos sumadas. */
function TotalFigure({ amount, currency }: { amount: number; currency: Currency }) {
  const counted = useCountUp(amount);
  return (
    <p className="font-medium leading-[1.08] tracking-[-0.045em] tabular-nums text-[clamp(2.5rem,13vw,3.5rem)]">
      {money(Math.round(counted), currency)}
    </p>
  );
}

/** "Ganaste $ 52.603 (+2,6%)", o nada si no cambió. */
function gainSentence(t: Totals, currency: Currency): string | null {
  const gain = Number(t.gain);
  if (Math.abs(gain) < 0.5) return null;
  const invested = Number(t.invested);
  const pct = invested > 0 ? pctText((gain / invested) * 100) : null;
  return `${gain > 0 ? "Ganaste" : "Perdiste"} ${money(Math.round(Math.abs(gain)), currency)}${pct ? ` (${pct})` : ""}`;
}

function InvestmentRow({ inv, tour }: { inv: Investment; tour?: boolean }) {
  const closed = !!inv.closed_at;
  const sub = subLine(inv);
  const status = statusLine(inv);
  // En la lista, sin centavos: se ven en el detalle.
  const gain = signedMoney(Math.round(Number(inv.gain)), inv.currency);
  const pct = pctText(inv.gain_pct);
  const up = Number(inv.gain) > 0;
  // A la izquierda, qué es y cómo está; a la derecha, cuánto rindió.
  const lines = [sub ? { text: sub, tone: "quiet" as const } : null, status].filter((l): l is NonNullable<typeof l> => !!l);
  return (
    <Link href={`/inversiones/${inv.id}`} data-tour={tour ? "inversiones-item" : undefined} data-no-press
      className="block py-3.5 border-b border-border last:border-b-0 active:opacity-60 transition-opacity">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-semibold text-[15.5px] text-foreground truncate">{inv.name}</span>
        {!closed && (
          <span className="shrink-0 tabular-nums text-right text-base font-medium text-foreground">{money(Math.round(Number(inv.value)), inv.currency)}</span>
        )}
      </span>
      {(lines.length > 0 || gain) && (
        <span className="mt-0.5 flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 flex-1">
            {lines.map((l, i) => (
              <span key={i} className={`flex items-baseline gap-1.5 ${i > 0 ? "mt-0.5" : ""} ${TONE[l.tone]}`}>
                {l.tone === "pending" && <span aria-hidden="true" className="w-1.5 h-1.5 shrink-0 rounded-full bg-amber-500 -translate-y-0.5" />}
                <span className="leading-snug">{l.text}</span>
              </span>
            ))}
          </span>
          {gain && (
            <span className={`shrink-0 tabular-nums text-right ${up ? "text-emerald-800" : "text-foreground"}`}>
              {closed
                ? <><span className="text-muted-foreground">{up ? "Ganaste " : "Perdiste "}</span>{money(Math.round(Math.abs(Number(inv.gain))), inv.currency)}</>
                : gain}
              {pct && <span className={up ? "" : "text-muted-foreground"}> · {pct}</span>}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}

/** Lo que espera algo: un plazo fijo vencido o un valor viejo. */
function alertText(inv: Investment): string {
  if (inv.matured && inv.maturity_date) return `${inv.name} venció el ${shortDate(inv.maturity_date)}. ¿Lo renovaste?`;
  return inv.value_date
    ? `${inv.name}: el valor es de hace ${inv.stale_days} días.`
    : `${inv.name}: hace ${inv.stale_days} días que no cargás cuánto vale.`;
}

export default function InversionesPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const reaccionar = useReaccion();
  const [data, setData] = useState<InvestmentsResponse | null>(null);
  const [error, setError] = useState("");
  // null: cerrado; "": abre en el paso del tipo; un tipo: arranca con ese.
  const [creating, setCreating] = useState<Kind | "" | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(() => {
    setError("");
    api.get<InvestmentsResponse>("/investments")
      .then(({ data }) => setData(data))
      .catch(e => setError(getErrorMessage(e, "No pudimos traer tus inversiones.")));
  }, []);
  useEffect(() => { load(); }, [load]);

  const all = data?.investments ?? [];
  const active = all.filter(i => !i.closed_at);
  // Las rescatadas, la más reciente primero.
  const closed = all.filter(i => i.closed_at).sort((a, b) => b.closed_at!.localeCompare(a.closed_at!));
  // Lo que espera algo primero; después lo que más vale, cada moneda junta.
  const ordered = [...active].sort((a, b) =>
    Number(b.matured || isStale(b)) - Number(a.matured || isStale(a))
    || a.currency.localeCompare(b.currency)
    || Number(b.value) - Number(a.value));
  const alerts = active.filter(i => i.matured || isStale(i));
  const ars = data?.totals.ARS;
  const usd = data?.totals.USD;
  // Una sola frase para las dos monedas, cada una con su cifra.
  const gains = [ars && gainSentence(ars, "ARS"), usd && gainSentence(usd, "USD")].filter((g): g is string => !!g);
  const gainLine = gains.length === 2 && gains[0].split(" ")[0] === gains[1].split(" ")[0]
    ? `${gains[0]} y ${gains[1].split(" ").slice(1).join(" ")}`
    : gains.map((g, i) => (i ? g.charAt(0).toLowerCase() + g.slice(1) : g)).join(" y ");

  const header = (
    <div className="flex items-center justify-between gap-2">
      <h1 className={H1}>Inversiones</h1>
      <div className="flex items-center gap-0.5 shrink-0">
        {active.length > 0 && (
          <button onClick={() => setCreating("")} data-tour="inversiones-add"
            className="h-11 pl-3.5 pr-4 rounded-full bg-ink text-background text-[14.5px] font-semibold inline-flex items-center gap-1.5 active:scale-[0.97] transition-transform duration-100">
            <Plus className="w-[18px] h-[18px]" /> Inversión
          </button>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button title="Más acciones" aria-label="Más acciones"
              className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none">
              <MoreVertical className="w-5 h-5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className={MENU_PANEL}>
              <DropdownMenu.Item asChild><PrivacyMenuItem /></DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );

  const form = creating !== null && (
    <InvestmentForm initialKind={creating || undefined} first={all.length === 0}
      onClose={() => setCreating(null)}
      onSaved={() => { setCreating(null); reaccionar("guardado", "Inversión cargada"); load(); }} />
  );

  if (error && !data) {
    return (
      <div className="space-y-4 md:space-y-6">
        {header}
        <div role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] text-rose-900">
          <p>{error} Tus datos están bien: fijate si tenés conexión.</p>
          <button onClick={load} className="mt-1 min-h-[40px] font-semibold underline">Probar de nuevo</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4 md:space-y-6">
        {header}
        <div aria-busy="true" className={`${BLOCK} h-[200px] animate-pulse`}>
          <span className="sr-only">Cargando tus inversiones</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 md:pb-16">
      {active.length > 0 && <ProductTour tourId="inversiones-intro" steps={tourSteps(alerts.length > 0)} />}
      {header}

      {active.length === 0 ? (
        // Como el vacío de Créditos: qué es, para qué sirve y un botón. El formulario trae su guía.
        <section className="px-2 pt-2">
          <TrendingUp className="w-8 h-8 text-[#3B2FB3]" strokeWidth={1.6} aria-hidden="true" />
          <p className="mt-3 text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground">
            {closed.length > 0 ? "No tenés nada invertido ahora" : "Todavía no cargaste ninguna inversión"}
          </p>
          <p className="mt-1 text-[15.5px] leading-snug text-muted-foreground">
            Un plazo fijo, un fondo, acciones o dólares: cargalo una vez y mirá cuánto vale hoy, no sólo cuánto pusiste.
          </p>
          <button onClick={() => setCreating("")} className="mt-4 h-[52px] px-6 rounded-full bg-ink text-background font-semibold text-[15.5px] active:scale-[0.98] transition-transform duration-100">
            Cargar inversión
          </button>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 items-start">
          <section className={BLOCK} data-tour="inversiones-total">
            <div className="px-2.5">
              <p className="text-[16.5px] font-medium">Vale hoy</p>
              {ars
                ? <TotalFigure amount={Number(ars.value)} currency="ARS" />
                : usd && <TotalFigure amount={Number(usd.value)} currency="USD" />}
              {ars && usd && (
                <p className="mt-0.5 text-[19px] font-medium tracking-[-0.02em] tabular-nums">y {money(usd.value, "USD")} en dólares</p>
              )}
              {gainLine && <p className="mt-1.5 text-[15px] leading-snug text-white/85 tabular-nums">{gainLine} contra lo que pusiste</p>}
            </div>
            {alerts.length > 0 && (
              <div className={`mt-4 ${GLASS} px-1.5 py-1.5`} data-tour="inversiones-alert">
                {alerts.slice(0, 3).map(inv => (
                  <Link key={inv.id} href={`/inversiones/${inv.id}`} data-no-press
                    className="flex items-center gap-3 min-h-[48px] px-2.5 py-2 rounded-[18px] active:bg-white/10 transition-colors">
                    <span className="flex-1 min-w-0 text-[15px] leading-snug">{alertText(inv)}</span>
                    <ArrowRight className="w-[17px] h-[17px] shrink-0 opacity-80" />
                  </Link>
                ))}
                {alerts.length > 3 && <p className="px-2.5 pb-1.5 text-sm text-white/80">Y {alerts.length - 3} más en la lista.</p>}
              </div>
            )}
          </section>

          <section className="px-2">
            <h2 className="mb-0.5 text-[22px] font-medium tracking-[-0.03em] text-foreground">Dónde está</h2>
            <MotionList>
              {ordered.map((inv, i) => <InvestmentRow key={inv.id} inv={inv} tour={i === 0} />)}
            </MotionList>
          </section>
        </div>
      )}

      {closed.length > 0 && (
        <MotionList as="section" className="px-2">
          <button onClick={() => setShowClosed(v => !v)} aria-expanded={showClosed}
            className="w-full min-h-[48px] flex items-center justify-between gap-3 text-[15.5px] font-medium text-muted-foreground">
            Rescatadas ({closed.length})
            <ChevronDown className={`w-[18px] h-[18px] transition-transform ${showClosed ? "rotate-180" : ""}`} />
          </button>
          {showClosed && (
            <div>
              {closed.map(inv => <InvestmentRow key={inv.id} inv={inv} />)}
            </div>
          )}
        </MotionList>
      )}

      {form}
    </div>
  );
}
