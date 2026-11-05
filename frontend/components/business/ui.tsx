"use client";

import { useState } from "react";
import { useCountUp } from "@/components/ui/count-up";
import { formatARSRound } from "@/lib/utils";

/** El menú ⋮ de una fila: flota sobre la lista, así que va de vidrio. */
export const GLASS_MENU = "w-52 z-50 p-1.5 rounded-[22px] border border-white/70 bg-card/90 backdrop-blur-2xl backdrop-saturate-150 shadow-flota animate-fade-in";
export const GLASS_MENU_ITEM = "flex items-center min-h-[44px] px-3 rounded-2xl text-[15px] font-medium text-foreground data-[highlighted]:bg-ink/[0.06] outline-none cursor-pointer";
export const SCREEN_TITLE = "text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground";
export const SECTION_TITLE = "text-[22px] font-medium tracking-[-0.03em] text-foreground";

/** Lo que falló y qué hacer: nunca una pantalla en blanco ni un "todavía no cargaste nada". */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="px-2 py-3">
      <p className="text-[15.5px] text-foreground">{message}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">Tus datos están bien. Fijate si tenés conexión y probá de nuevo.</p>
      <button type="button" onClick={onRetry}
        className="mt-3 h-11 px-5 rounded-full bg-ink text-background font-semibold text-[15px] active:scale-[0.97] transition-transform duration-100">
        Probar de nuevo
      </button>
    </div>
  );
}

/** Lo que no hay todavía, y el botón para cargarlo. */
export function EmptyState({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="px-2 py-3">
      <p className="text-[15.5px] leading-snug text-muted-foreground">{text}</p>
      {action && (
        <button type="button" onClick={onAction}
          className="mt-3 h-11 px-5 rounded-full bg-ink text-background font-semibold text-[15px] active:scale-[0.97] transition-transform duration-100">
          {action}
        </button>
      )}
    </div>
  );
}

/**
 * Borrar sin la ventana del navegador, para lo que no pasa por la ficha
 * (`SheetActions`): un texto rojo discreto que pregunta ahí mismo.
 */
export function ConfirmDelete({ label, question, disabled, onConfirm }: {
  label: string;
  question: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" disabled={disabled} onClick={() => setAsking(true)}
        className="min-h-[44px] px-1.5 font-semibold text-[15px] text-destructive disabled:opacity-50">
        {label}
      </button>
    );
  }
  return (
    <div className="rounded-[22px] bg-rose-50 border border-rose-200 p-2.5" role="alert">
      <p className="px-1.5 pb-2 text-[15px] font-medium text-rose-900">{question}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" autoFocus onClick={() => setAsking(false)}
          className="h-12 rounded-full bg-white border border-rose-200 font-semibold text-[15px] text-foreground active:scale-[0.98] transition-transform duration-100">
          No, dejarlo
        </button>
        <button type="button" disabled={disabled} onClick={onConfirm}
          className="h-12 rounded-full bg-destructive text-destructive-foreground font-semibold text-[15px] disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
          Sí, borrar
        </button>
      </div>
    </div>
  );
}

/** La cifra principal del bloque violeta. Cuenta hasta el valor: una sola por pantalla. */
export function BlockFigure({ amount, className = "" }: { amount: number; className?: string }) {
  const counted = useCountUp(amount);
  return (
    <p className={`font-medium leading-[1.08] tracking-[-0.045em] tabular-nums ${className}`}>
      {formatARSRound(Math.round(counted))}
    </p>
  );
}
