"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * El selector de mes de Inicio: una píldora con flechas. Compartido por el
 * dashboard del hogar y el del negocio, que eligen el mes igual.
 */
export function MonthPill({ label, onPrev, onNext, compact = false }: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  /** Sin el ícono y sin ancho mínimo, para compartir la línea con un título. */
  compact?: boolean;
}) {
  return (
    <div className={`inline-flex items-center gap-1 rounded-full border border-border bg-card pr-1.5 py-1.5 ${compact ? "pl-1.5" : "pl-3"}`}>
      {!compact && <CalendarDays className="w-4 h-4 text-primary shrink-0" />}
      <button onClick={onPrev} aria-label="Mes anterior" className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className={`text-sm font-bold text-foreground capitalize px-0.5 text-center ${compact ? "whitespace-nowrap" : "min-w-[100px]"}`}>{label}</span>
      <button onClick={onNext} aria-label="Mes siguiente" className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
