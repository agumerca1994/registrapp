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

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export const isoDate = (d: Date) => format(d, "yyyy-MM-dd");

/** One month. Cells sit edge to edge so a selected range reads as a
 *  continuous stripe; only its two ends get rounded. */
function MonthGrid({ month, from, to, onPick, onHover }: {
  month: Date;
  from: Date | null;
  to: Date | null;
  onPick: (day: Date) => void;
  onHover?: (day: Date | null) => void;
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  return (
    <div className="w-[248px]">
      <p className="text-center text-xs font-semibold text-foreground capitalize mb-2">
        {format(month, "MMMM yyyy", { locale: es })}
      </p>
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground/70">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {days.map(day => {
          // Leading/trailing cells stay blank: greyed-out neighbours would join
          // the band and read as part of the range.
          if (!isSameMonth(day, month)) return <div key={day.toISOString()} className="h-8" />;

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
              className={[
                "h-8 text-xs transition-colors",
                edge ? "bg-primary text-primary-foreground font-semibold"
                     : inside ? "bg-accent text-primary"
                     : "hover:bg-accent",
                isStart && isEnd ? "rounded-full"
                  : isStart ? "rounded-l-full"
                  : isEnd ? "rounded-r-full"
                  : inside ? "" : "rounded-full",
                // Today stays legible whether or not it's the selection: a
                // ring when it isn't, the filled circle when it is.
                !edge && isToday(day) ? "font-bold text-primary ring-1 ring-inset ring-primary/50" : "",
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

/**
 * The bordered calendar box: month arrows, one or two grids, optional footer.
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
    <div className={`rounded-2xl border-2 border-ink bg-card shadow-hero p-3 w-max max-w-[calc(100vw-2rem)] ${className}`}>
      <div className="flex items-center justify-between mb-1">
        <button type="button" onClick={() => onMonthChange(subMonths(month, 1))}
          className="p-1 rounded-full hover:bg-accent text-muted-foreground" aria-label="Mes anterior">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => onMonthChange(addMonths(month, 1))}
          className="p-1 rounded-full hover:bg-accent text-muted-foreground" aria-label="Mes siguiente">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="flex gap-4">
        <MonthGrid month={month} from={from} to={to} onPick={onPick} onHover={onHover} />
        {months === 2 && (
          <div className="hidden sm:block">
            <MonthGrid month={addMonths(month, 1)} from={from} to={to} onPick={onPick} onHover={onHover} />
          </div>
        )}
      </div>
      {footer && (
        <div className="flex items-center justify-between gap-4 mt-2 pt-2 border-t text-xs">{footer}</div>
      )}
    </div>
  );
}
