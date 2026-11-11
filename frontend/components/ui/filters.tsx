"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { startOfMonth, isAfter, isBefore, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Search, X, ArrowUp, CalendarDays } from "lucide-react";
import { useListMotion } from "@/lib/motion";
import { CalendarPanel, isoDate } from "@/components/ui/calendar";
import {
  Listbox, useAnchoredPanel, useDismiss, type SelectOption,
} from "@/components/ui/listbox";

/**
 * The app's one filter/search bar. Every list with searching, sorting or
 * filtering renders this one.
 *
 * The layout, in order:
 *
 *   <FilterBar>
 *     <FilterRow>
 *       <CollapsibleSearch />            // circle that opens into a search pill
 *       {!searchOpen && <>               // chips hide while the box is open
 *         <SortChip … /> …
 *         <FilterChip label="Personalizado" icon={SlidersHorizontal} … />
 *       </>}
 *     </FilterRow>
 *     {showPanel && !searchOpen && (
 *       <FilterPanel>
 *         <PillSelect … /> <PillDateRange … />
 *         <ClearFilters onClick={…} />   // only while something is active
 *       </FilterPanel>
 *     )}
 *   </FilterBar>
 *
 * Four rules that are easy to lose:
 * - The strip is NOT wrapped in a `<Card>`. It sits bare above the list; boxing it
 *   turns a control strip into a second panel competing with the content. Only
 *   the panel, which opens on demand, is a block.
 * - Sorting is tri-state: inactive → asc → desc → inactive, where inactive
 *   means the list's own default order.
 * - A period is ONE control (`PillDateRange`), not a "desde" input next to a
 *   "hasta" input.
 * - What's on is dark, like every other selection in the app (`ChoiceChips`). The
 *   chips measure 40 px and touch 44.
 */

export function FilterBar({ children }: { children: React.ReactNode }) {
  const motion = useListMotion<HTMLDivElement>();
  return <div ref={motion} className="space-y-2">{children}</div>;
}

export function FilterRow({ children }: { children: React.ReactNode }) {
  const motion = useListMotion<HTMLDivElement>();
  return <div ref={motion} className="flex items-center gap-1.5 flex-wrap min-h-10">{children}</div>;
}

export function FilterPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-border bg-card p-2 [&>*]:flex-1 [&>*]:min-w-[calc(50%-0.25rem)] sm:[&>*]:min-w-[180px]">
      {children}
    </div>
  );
}

const CHIP_BASE = "relative inline-flex items-center justify-center gap-1.5 h-10 shrink-0 text-[13px] font-medium rounded-full border transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.97] before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-['']";
const CHIP_ON = "border-transparent bg-ink text-background";
const CHIP_OFF = "border-border bg-card text-foreground hover:bg-accent";

export function SortChip({ label, active, dir, onClick }: {
  label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`${CHIP_BASE} px-3.5 ${active ? CHIP_ON : CHIP_OFF}`}>
      {label}
      {active && <ArrowUp className={`w-3.5 h-3.5 transition-transform duration-200 ${dir === "desc" ? "rotate-180" : ""}`} />}
    </button>
  );
}

/**
 * The toggle that opens the panel. With an icon it's a circle at the end of the
 * row and the label goes to `aria-label`: "Personalizado" in text pushed the row
 * past the width of a phone.
 */
export function FilterChip({ label, icon: Icon, active, onClick }: {
  label: string; icon?: React.ElementType; active: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={label} title={label}
      className={`${CHIP_BASE} ${Icon ? "w-10 ml-auto" : "px-3.5"} ${active ? CHIP_ON : CHIP_OFF}`}>
      {Icon ? <Icon className="w-[18px] h-[18px]" /> : label}
    </button>
  );
}

// Text colour is applied by each control rather than baked in: an unset
// filter shows the field's name and has to read as a placeholder, not as a
// value the user chose.
const PILL = "w-full h-10 rounded-full border border-border bg-background text-[13px] font-medium";

/**
 * The filter bar's select. Same `Listbox` as the form's — an OS option list
 * dropping on top of the app is exactly what "genérico" looks like — wearing
 * the pill instead of the field.
 *
 * The empty option carries the field's name ("Categoría", "Fuente"), not
 * "Todas las categorías": there's no label above the pill, so that option *is*
 * the label, and it's on screen far more often unset than set.
 */
export function PillSelect({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <Listbox
      value={value} onChange={onChange} options={options} placeholder={placeholder}
      className="flex-1"
      triggerClassName={`${PILL} ${value ? "text-foreground" : "text-muted-foreground"} flex items-center gap-2 px-3 text-left`}
      chevronClassName="w-3.5 h-3.5"
    />
  );
}

// ── Date range ────────────────────────────────────────────────────────────────

// The year is noise while you're inside the current one, and essential the
// moment a range reaches out of it.
function short(s: string): string {
  const d = parseISO(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return format(d, sameYear ? "d MMM" : "d MMM yy", { locale: es });
}

/**
 * Single-control date range, the way a flight search does it: one pill that
 * opens the shared one-month calendar, first click sets the start, second the
 * end, and the days between fill in as you move the mouse. Two separate date inputs
 * make the user think in "from"/"to" fields; this lets them think in periods.
 *
 * `from`/`to` are ISO `yyyy-MM-dd` (or "") so the caller can hand them straight
 * to a query string.
 */
export function PillDateRange({ from, to, onChange, placeholder = "Rango de fechas" }: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<Date | null>(null);
  const [month, setMonth] = useState(() => startOfMonth(from ? parseISO(from) : new Date()));
  const { trigger, panel, pos, reset } = useAnchoredPanel(open, [month], "left");
  useDismiss(open, () => setOpen(false), [trigger, panel]);

  const fromD = from ? parseISO(from) : null;
  const toD = to ? parseISO(to) : null;
  // While only the start is set, the hovered day previews where the range ends.
  const previewEnd = toD ?? (fromD && hover && isAfter(hover, fromD) ? hover : null);

  const pick = (day: Date) => {
    if (!fromD || toD) { onChange(isoDate(day), ""); return; }   // (re)start a range
    if (isBefore(day, fromD)) { onChange(isoDate(day), from); }  // picked backwards: swap
    else onChange(from, isoDate(day));
    setHover(null);
    setOpen(false);
  };

  const label = from && to ? `${short(from)} – ${short(to)}`
    : from ? `${short(from)} – …`
    : placeholder;

  return (
    <div className="relative flex-1">
      <button ref={trigger} type="button" onClick={() => { setOpen(v => !v); reset(); }}
        className={`${PILL} text-foreground flex items-center gap-2 px-3 text-left`}>
        <CalendarDays className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className={`flex-1 truncate ${from ? "" : "text-muted-foreground"}`}>{label}</span>
        {from && (
          <span role="button" tabIndex={0} aria-label="Limpiar fechas"
            onClick={e => { e.stopPropagation(); onChange("", ""); }}
            onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); onChange("", ""); } }}
            className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-3.5 h-3.5" />
          </span>
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div ref={panel} className="fixed z-[100]"
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}>
        <CalendarPanel
          month={month}
          onMonthChange={setMonth}
          from={fromD}
          to={previewEnd}
          onPick={pick}
          onHover={setHover}
          footer={
            <>
              <span className="text-muted-foreground">
                {from && !to ? "Elegí la fecha de fin" : from ? `${short(from)} – ${short(to)}` : "Elegí la fecha de inicio"}
              </span>
              {from && (
                <button type="button" onClick={() => { onChange("", ""); setHover(null); }}
                  className="text-muted-foreground hover:text-foreground shrink-0">
                  Limpiar
                </button>
              )}
            </>
          }
        />
        </div>,
        document.body,
      )}
    </div>
  );
}

export function ClearFilters({ onClick, label = "Limpiar" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick}
      className="!flex-none !min-w-0 ml-auto h-10 px-3 inline-flex items-center gap-1 rounded-full text-[13px] font-medium text-foreground hover:bg-accent transition-colors">
      <X className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

export function CollapsibleSearch({ open, onOpen, onClose, value, onChange, placeholder }: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  if (!open) {
    return (
      <button type="button" onClick={onOpen} title="Buscar" aria-label="Buscar"
        className={`${CHIP_BASE} ${CHIP_OFF} w-10`}>
        <Search className="w-[18px] h-[18px]" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-1 min-w-[160px] h-10 rounded-full border border-border bg-card pl-3.5 pr-1 focus-within:border-primary/50 transition-colors">
      <Search className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
      <input
        autoFocus
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" onClick={onClose} aria-label="Cerrar la búsqueda"
        className="w-8 h-8 rounded-full bg-ink/[0.07] text-foreground flex items-center justify-center shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
