"use client";

import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, isToday, isAfter, isBefore, format, addMonths,
  subMonths,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The app's only calendar. Hand-built on date-fns like `/calendario`'s grid —
 * the project has no calendar library and doesn't need one — and shared so the
 * date range in a filter bar and a single date in a form look identical.
 *
 * `from`/`to` drive the painting for both cases: a range highlights the band
 * between them, a single date is just `from === to`.
 */

const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export const isoDate = (d: Date) => format(d, "yyyy-MM-dd");

/** One month. Cells sit edge to edge so a selected range reads as a
 *  continuous stripe; only its two ends get rounded. */
function MonthGrid({ month, from, to, onPick, onHover, title = false }: {
  month: Date;
  from: Date | null;
  to: Date | null;
  onPick: (day: Date) => void;
  onHover?: (day: Date | null) => void;
  /** El primer mes lo nombra el encabezado del panel, entre las flechas. */
  title?: boolean;
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  return (
    <div className="w-[280px] max-w-full">
      {title && (
        <p className="text-center text-[15px] font-semibold text-foreground first-letter:uppercase mb-2">
          {format(month, "MMMM yyyy", { locale: es })}
        </p>
      )}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map(d => (
          <div key={d} title={d} className="text-center font-marca text-[11px] text-muted-foreground">{d[0]}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map(day => {
          // Leading/trailing cells stay blank: greyed-out neighbours would join
          // the band and read as part of the range.
          if (!isSameMonth(day, month)) return <div key={day.toISOString()} className="h-10" />;

          const isStart = !!from && isSameDay(day, from);
          const isEnd = !!to && isSameDay(day, to);
          const inside = !!from && !!to && isAfter(day, from) && isBefore(day, to);
          const edge = isStart || isEnd;

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onPick(day)}
              onMouseEnter={() => onHover?.(day)}
              onMouseLeave={() => onHover?.(null)}
              aria-label={format(day, "d 'de' MMMM yyyy", { locale: es })}
              aria-pressed={edge}
              className={[
                "h-10 text-sm tabular-nums transition-colors",
                edge ? "bg-primary text-primary-foreground font-semibold"
                     : inside ? "bg-accent text-[#3B2FB3]"
                     : "text-foreground hover:bg-accent",
                isStart && isEnd ? "rounded-full"
                  : isStart ? "rounded-l-full"
                  : isEnd ? "rounded-r-full"
                  : inside ? "" : "rounded-full",
                // Today stays legible whether or not it's the selection: a
                // ring when it isn't, the filled circle when it is.
                !edge && isToday(day) ? "font-bold text-[#3B2FB3] ring-1 ring-inset ring-primary/50" : "",
              ].join(" ")}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ARROW = "w-10 h-10 shrink-0 rounded-full bg-ink/[0.06] text-foreground flex items-center justify-center active:scale-[0.95] transition-transform duration-100";

/**
 * The calendar box: month arrows, one or two grids, optional footer.
 * Callers position it — absolutely under a filter pill, or portalled to the
 * body and anchored to a form field (see `DateField`), which is what keeps it
 * above a modal instead of clipped by its `overflow-y-auto`.
 */
export function CalendarPanel({ months = 1, month, onMonthChange, from, to, onPick, onHover, footer, className = "" }: {
  months?: 1 | 2;
  month: Date;
  onMonthChange: (month: Date) => void;
  from: Date | null;
  to: Date | null;
  onPick: (day: Date) => void;
  onHover?: (day: Date | null) => void;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-[26px] border border-white/70 bg-card/95 backdrop-blur-xl shadow-flota p-3 w-max max-w-[calc(100vw-1.25rem)] animate-fade-in ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <button type="button" onClick={() => onMonthChange(subMonths(month, 1))} className={ARROW} aria-label="Mes anterior">
          <ChevronLeft className="w-[18px] h-[18px]" />
        </button>
        <p aria-live="polite" className="text-[15px] font-semibold text-foreground first-letter:uppercase">
          {format(month, "MMMM yyyy", { locale: es })}
        </p>
        <button type="button" onClick={() => onMonthChange(addMonths(month, 1))} className={ARROW} aria-label="Mes siguiente">
          <ChevronRight className="w-[18px] h-[18px]" />
        </button>
      </div>
      <div className="flex gap-4">
        <MonthGrid month={month} from={from} to={to} onPick={onPick} onHover={onHover} />
        {months === 2 && (
          <div className="hidden sm:block">
            <MonthGrid title month={addMonths(month, 1)} from={from} to={to} onPick={onPick} onHover={onHover} />
          </div>
        )}
      </div>
      {footer && (
        <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-ink/[0.08] text-xs">{footer}</div>
      )}
    </div>
  );
}
