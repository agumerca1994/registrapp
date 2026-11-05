"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/** El selector de día de Ventas. Va sobre el bloque violeta, así que es de vidrio. */
export function DayPill({ label, onPrev, onNext, prevDisabled, nextDisabled, ...rest }: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  const arrow = "w-9 h-9 rounded-full flex items-center justify-center text-white active:scale-[0.95] transition-transform duration-100 disabled:opacity-30";
  return (
    <div {...rest} className="inline-flex items-center rounded-full bg-white/15 border border-white/25 backdrop-blur-lg p-0.5">
      <button onClick={onPrev} aria-label="Día anterior" disabled={prevDisabled} className={arrow}>
        <ChevronLeft className="w-[18px] h-[18px]" />
      </button>
      <span className="text-sm font-semibold text-white px-0.5 min-w-[84px] text-center whitespace-nowrap first-letter:uppercase">{label}</span>
      <button onClick={onNext} aria-label="Día siguiente" disabled={nextDisabled} className={arrow}>
        <ChevronRight className="w-[18px] h-[18px]" />
      </button>
    </div>
  );
}
