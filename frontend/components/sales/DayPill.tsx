"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

/** El selector de día de Ventas: la misma píldora que el selector de mes. */
export function DayPill({ label, onPrev, onNext, prevDisabled, nextDisabled }: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-card shadow-chip pl-3 pr-1.5 py-1.5">
      <CalendarDays className="w-4 h-4 text-primary shrink-0" />
      <button onClick={onPrev} aria-label="Día anterior" disabled={prevDisabled}
        className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors disabled:opacity-30">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm font-bold text-foreground px-0.5 min-w-[100px] text-center first-letter:uppercase">{label}</span>
      <button onClick={onNext} aria-label="Día siguiente" disabled={nextDisabled}
        className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors disabled:opacity-30">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
