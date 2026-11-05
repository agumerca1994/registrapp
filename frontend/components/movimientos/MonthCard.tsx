"use client";

import { useState } from "react";
import Link from "next/link";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatARSRound, formatPct, formatUSD } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { useCountUp } from "@/components/ui/count-up";
import { SummaryCard, SummaryHeader, ChainRow } from "@/components/ui/summary-card";
import { useMovimientos } from "@/components/movimientos/MovimientosContext";

function Figure({ label, amount, format }: { label: string; amount: number; format: (n: number) => string }) {
  const counted = useCountUp(amount);
  return (
    <>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl md:text-4xl font-medium tracking-[-0.03em] text-foreground tabular-nums whitespace-nowrap">{format(counted)}</p>
    </>
  );
}

// Sin centavos a la vista: los dos números tienen que entrar lado a lado en un
// celular. Los exactos están en el detalle.
const usdRound = (n: number) => formatUSD(Math.round(n)).replace(/,00$/, "");

/**
 * Cómo viene el mes, compacto: las dos cifras arriba y las cuentas detrás de "Ver
 * detalle", para que la tabla de movimientos quede a la vista sin bajar.
 */
export function MonthCard() {
  useAmountsHidden();  // repinta la tarjeta al ocultar/mostrar montos
  const { summary: data, failed, year, month, periodLabel } = useMovimientos();
  const [open, setOpen] = useState(false);
  const now = new Date();

  if (failed && !data) {
    return <p className="text-muted-foreground text-sm">No se pudo cargar el resumen de este mes. Probá recargar la página.</p>;
  }
  if (!data) return <Card variant="hero" className="h-[136px] animate-pulse" />;

  const closed = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;
  const monthName = periodLabel.split(" ")[0];

  // La cuota de la hipoteca es un gasto recién cuando se registra. Mientras tanto
  // se descuenta acá, igual que en Inicio (`analytics.today_summary`): si no, las
  // dos pantallas dicen un número distinto para lo mismo. Un mes pasado sin
  // registro ya no va a salir: ahí no se proyecta nada.
  const pendingMortgage = !closed && data.mortgage_is_projected ? Number(data.mortgage_payment ?? 0) : 0;
  const left = Number(data.ars_available) - pendingMortgage;

  // The dollar pocket has to show up whenever dollars moved *or* were held at
  // either end of the month: hiding it at a zero holding hid it in exactly the
  // month where the household ran out of dollars.
  const start = Number(data.usd_holding_start);
  const end = Number(data.usd_holding);
  const initial = Number(data.usd_initial);
  const bought = Number(data.usd_bought);
  const sold = Number(data.usd_sold);
  const earned = Number(data.usd_earned);
  const paid = Number(data.usd_paid);
  const adjustments = Number(data.usd_adjustments);
  const hasDollars = !!(start || end || initial || bought || sold || earned || paid || adjustments);
  // Backstop, not a term: the chain above is exhaustive, so this is 0 unless a
  // new operation type ever lands without a row of its own here.
  const other = end - (start + initial + bought + earned - sold - paid + adjustments);

  const columns = hasDollars ? "sm:grid-cols-[1.35fr_1fr]" : "";
  return (
    <SummaryCard>
      <SummaryHeader
        title={closed ? `Cómo quedó ${monthName}` : isCurrent ? `Cómo viene ${monthName}` : `Lo que hay para ${monthName}`}
        open={open} onToggle={() => setOpen(v => !v)} />
      <div className={`grid border-t border-border/60 ${hasDollars ? "grid-cols-[1.35fr_1fr]" : "grid-cols-1"}`}>
        <div className="pl-4 md:pl-6 pr-2 pt-2.5 pb-3.5 min-w-0">
          <Figure label="En pesos" amount={left} format={formatARSRound} />
        </div>
        {hasDollars && (
          <Link href="/divisas" className="pl-3 md:pl-6 pr-3 pt-2.5 pb-3.5 min-w-0 border-l border-border/60 hover:bg-accent/40 transition-colors">
            <Figure label="En dólares" amount={end} format={usdRound} />
          </Link>
        )}
      </div>

      {open && (
        <div className="border-t border-border/60 text-sm">
          <div className={`grid grid-cols-1 ${columns}`}>
            {/* Buying dollars isn't an expense — it's a transfer between these two
                pockets — so it only makes sense as a line that leaves one and
                enters the other. */}
            <div className="px-4 md:px-6 py-3.5 space-y-1 min-w-0">
              <ChainRow label="Ingresos" sign="+" value={formatARS(data.total_income)} />
              <ChainRow label="Egresos" sign="−" value={formatARS(data.total_expenses)} />
              {data.fx_bought_ars > 0 && <ChainRow label="Compré dólares" sign="−" value={formatARS(data.fx_bought_ars)} />}
              {data.fx_sold_ars > 0 && <ChainRow label="Vendí dólares" sign="+" value={formatARS(data.fx_sold_ars)} />}
              {pendingMortgage > 0 && <ChainRow label="Hipoteca por pagar" sign="−" value={formatARS(pendingMortgage)} />}
              <ChainRow strong label="Queda" value={formatARS(left)} />
            </div>
            {hasDollars && (
              <div className="px-4 md:px-6 py-3.5 space-y-1 min-w-0 border-t sm:border-t-0 sm:border-l border-border/60">
                <ChainRow label="Tengo al inicio" value={formatUSD(start)} />
                {initial !== 0 && <ChainRow label="Saldo inicial declarado" sign="+" value={formatUSD(initial)} />}
                {bought > 0 && <ChainRow label="Compré" sign="+" value={formatUSD(bought)} />}
                {earned > 0 && <ChainRow label="Cobré" sign="+" value={formatUSD(earned)} />}
                {sold > 0 && <ChainRow label="Vendí" sign="−" value={formatUSD(sold)} />}
                {paid > 0 && <ChainRow label="Pagué" sign="−" value={formatUSD(paid)} />}
                {[adjustments, other].filter(v => Math.abs(v) >= 0.005).map((v, i) => (
                  <ChainRow key={i} label="Ajustes" sign={v >= 0 ? "+" : "−"} value={formatUSD(Math.abs(v))} />
                ))}
                <ChainRow strong label="Tengo" value={formatUSD(end)} />
                {data.usd_holding_ars !== null && end !== 0 && (
                  <p className="text-xs text-muted-foreground text-right">≈ {formatARS(data.usd_holding_ars)}</p>
                )}
              </div>
            )}
          </div>
          {data.inflation_pct !== null && (
            <p className="px-4 md:px-6 py-2.5 text-xs text-muted-foreground border-t border-border/60">Inflación del mes: {formatPct(data.inflation_pct)}</p>
          )}
        </div>
      )}
    </SummaryCard>
  );
}
