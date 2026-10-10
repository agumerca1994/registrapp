"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * El selector de mes de Inicio: una píldora con flechas. Compartido por el
 * dashboard del hogar y el del negocio, que eligen el mes igual.
 */
export function MonthPill({ label, onPrev, onNext }: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-card shadow-chip pl-3 pr-1.5 py-1.5">
      <CalendarDays className="w-4 h-4 text-primary shrink-0" />
      <button onClick={onPrev} className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm font-bold text-foreground capitalize px-0.5 min-w-[100px] text-center">{label}</span>
      <button onClick={onNext} className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
