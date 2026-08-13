"use client";

import Link from "next/link";
import { ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * The app's summary hero — the one `variant="hero"` card at the top of a
 * screen, answering "where do I stand" before anything else on the page.
 * Established on the dashboard, reused on `/divisas`.
 *
 * Read top to bottom it's always the same three bands:
 *
 *   <SummaryCard>
 *     <SummaryHeader title="Cierre de agosto 2026" open={…} onToggle={…} />
 *     <SummarySection label="Estado actual" />
 *     <SummaryGrid cols={2}>
 *       <SummaryCell figure>   <SummaryFigure … />        // the answer
 *       <SummaryCell figure>   <SummaryFigure … />
 *       {open && <SummaryCell>  <ChainRow … />            // how it got there
 *       {open && <SummaryCell>  <ChainRow … />
 *     </SummaryGrid>
 *     {open && <SummaryTotal items={[…]} />}              // the result
 *   </SummaryCard>
 *
 * The rules behind the shape, each of which was a correction at some point:
 * - **Columns are equal, not content-sized.** A peso figure is three times as
 *   wide as a dollar one; a grid that sizes to content turns two equally
 *   important numbers into a headline and a footnote.
 * - **Rows are not forced to match each other.** `auto-rows-fr` across the
 *   whole grid stretched the figures row to the height of the taller chain
 *   row and left a band of dead space under the numbers.
 * - **The detail starts collapsed.** The figures are the answer; the chain is
 *   the arithmetic, and it belongs behind `Ver detalle`.
 * - **Signs ride on the amount, never on the label** (`−$ 1.517.916,00`).
 *   Hanging a `−`/`=` to the left of the label starts every row at a different
 *   x, which reads as a misaligned column.
 * - **Chains close on one shared total strip**, not one bold row each: a total
 *   per column restates the big figure directly above it, once per column.
 * - **Every chain lists movements.** Opening a chain on an already-consolidated
 *   subtotal while the one next to it lists its parts reads as an
 *   inconsistency even when the accounting justifies it.
 */

export function SummaryCard({ children }: { children: React.ReactNode }) {
  return (
    <Card variant="hero" className="p-0 overflow-hidden">
      {children}
    </Card>
  );
}

export function SummaryHeader({ title, open, onToggle, openLabel = "Ver detalle", closeLabel = "Ver menos" }: {
  title: string;
  open?: boolean;
  onToggle?: () => void;
  openLabel?: string;
  closeLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      {onToggle && (
        <button
          onClick={onToggle}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80 shrink-0"
        >
          {open ? closeLabel : openLabel}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}

/** Small band naming the row of figures under it. Sits tight against them. */
export function SummarySection({ label }: { label: string }) {
  return (
    <p className="px-4 md:px-6 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase border-t border-border/60">
      {label}
    </p>
  );
}

export function SummaryGrid({ cols = 1, children }: { cols?: 1 | 2; children: React.ReactNode }) {
  // One column below `sm`: two cells of ~170px wrap a peso figure onto a
  // second line and squash the chain labels.
  return (
    <div className={`grid ${cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
      {children}
    </div>
  );
}

const CELL = "px-4 md:px-6 min-w-0";

/** One cell of the grid. `figure` tightens the padding around a big number. */
export function SummaryCell({ figure = false, href, className = "", children }: {
  figure?: boolean;
  href?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const cls = `${CELL} ${figure ? "pt-2 pb-3 min-h-[84px] flex flex-col justify-start" : "py-4 text-sm space-y-1"} ${className}`;
  if (href) {
    return <Link href={href} className={`${cls} hover:bg-accent/40 transition-colors`}>{children}</Link>;
  }
  return <div className={cls}>{children}</div>;
}

export function SummaryFigure({ value, sub, trend }: {
  value: string;
  sub?: React.ReactNode;
  trend?: { label: string; positive: boolean };
}) {
  return (
    <>
      <p className="text-2xl md:text-4xl font-display font-bold text-foreground break-words">
        {value}
      </p>
      {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
      {trend && (
        <p className={`mt-1 text-sm font-medium flex items-center gap-1 ${trend.positive ? "text-emerald-600" : "text-rose-600"}`}>
          {trend.positive ? <TrendingUp className="w-4 h-4 shrink-0" /> : <TrendingDown className="w-4 h-4 shrink-0" />}
          {trend.label}
        </p>
      )}
    </>
  );
}

/** One line of a chain: label flush left, signed amount flush right. */
export function ChainRow({ label, value, sign, strong = false }: {
  label: string;
  value: string;
  sign?: "+" | "−";
  strong?: boolean;
}) {
  return (
    <p className={`flex items-baseline justify-between gap-4 ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
      <span className="truncate">{label}</span>
      <span className="font-medium tabular-nums shrink-0">{sign}{value}</span>
    </p>
  );
}

/**
 * The strip that closes every chain at once. `items` line up with the grid's
 * columns; the label repeats per item below `sm`, where there are no columns
 * left to say which amount is which.
 */
export function SummaryTotal({ label = "Queda", items }: {
  label?: string;
  items: string[];
}) {
  return (
    <div className={`grid grid-cols-1 ${items.length > 1 ? "sm:grid-cols-2" : ""} border-t-2 border-border bg-muted/60 text-sm`}>
      {items.map((value, i) => (
        <div key={i}
          className={`px-4 md:px-6 py-3 flex items-baseline justify-between gap-4 ${i > 0 ? "sm:border-l border-border/60" : ""}`}>
          <span className={`font-semibold text-foreground ${i > 0 ? "sm:hidden" : ""}`}>{label}</span>
          <span className={`font-bold tabular-nums text-foreground ${i > 0 ? "ml-auto" : ""}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}
