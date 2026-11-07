"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useExitGhost } from "@/lib/motion";
import { OverlayLayer, useOverlay } from "@/lib/overlay";
import { GLASS_SHEET } from "@/components/ui/glass";

/**
 * La hoja de un formulario, con el mismo vidrio de la ficha de un movimiento.
 *
 * No es un Dialog de Radix como la ficha: el combo y el calendario se abren en un
 * portal sobre `body`, y un Dialog modal bloquea los toques fuera de sí mismo. Y
 * lo que abra otra ventana fija va como hermano de esta hoja, no adentro: el
 * `backdrop-filter` hace que un `fixed` se ubique contra la hoja y no contra la
 * pantalla.
 *
 * Va en un portal sobre `body`, como el combo y el calendario. Adentro de
 * `#main-content` (que se desplaza) Safari de iOS la dibujaba debajo del
 * encabezado fijo del celular pese a su z-index, y con el teclado abierto la
 * hoja subía y quedaba tapada: no se veía lo que se escribía.
 *
 * El `<form>` va adentro con `FORM_SHEET_FORM`, y sus partes son `FORM_SHEET_BODY`
 * (se desplaza) y `FormSheetActions` (queda siempre a la vista).
 */
export function FormSheet({ title, onClose, stacked = false, children }: {
  title: string;
  onClose: () => void;
  /** Se abre encima de otra hoja, como crear una categoría desde un egreso. */
  stacked?: boolean;
  children: React.ReactNode;
}) {
  const ghost = useExitGhost<HTMLDivElement>();
  const layer = useOverlay(true, stacked);
  if (typeof document === "undefined") return null;
  return createPortal(
    <OverlayLayer.Provider value={layer}>
    <div
      ref={ghost}
      className={`fixed inset-0 ${stacked ? "z-[60]" : "z-50"} flex items-end sm:items-center justify-center bg-ink/30 p-2.5 animate-fade-in`}
      style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}
      onClick={onClose}
    >
      <div
        role="dialog" aria-modal="true" aria-label={title}
        onClick={e => e.stopPropagation()}
        className={`relative w-full sm:max-w-[460px] max-h-[90vh] flex flex-col rounded-[34px] ${GLASS_SHEET} shadow-flota animate-sheet-in`}
      >
        <div className="flex items-center justify-between gap-3 pl-5 pr-3 pt-3 pb-2 shrink-0">
          <h3 className="text-[22px] font-medium tracking-[-0.03em] text-foreground">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="w-10 h-10 shrink-0 rounded-full bg-ink/[0.07] text-foreground flex items-center justify-center active:scale-[0.95] transition-transform duration-100">
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>
        {children}
      </div>
    </div>
    </OverlayLayer.Provider>,
    document.body,
  );
}

export const FORM_SHEET_FORM = "flex-1 min-h-0 flex flex-col";
export const FORM_SHEET_BODY = "flex-1 min-h-0 overflow-y-auto overscroll-contain px-3.5 pb-3 space-y-3";

/** Guardar queda siempre a la vista, por largo que sea el formulario. */
export function FormSheetActions({ onCancel, saving, disabled, label, ...rest }: {
  onCancel: () => void;
  saving: boolean;
  disabled?: boolean;
  label: string;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <div className="shrink-0 flex items-center gap-2 px-3.5 pt-2.5 pb-3.5 border-t border-ink/[0.08]">
      <button type="button" onClick={onCancel}
        className="h-[52px] px-4 rounded-full font-semibold text-[15px] text-foreground active:scale-[0.98] transition-transform duration-100">
        Cancelar
      </button>
      <button type="submit" disabled={saving || disabled} {...rest}
        className="flex-1 h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
        {saving ? "Guardando…" : label}
      </button>
    </div>
  );
}

/**
 * El monto, grande y arriba: es lo primero que se mira y lo que más se corrige.
 * El `!` en el tamaño pisa los 16 px con `!important` de globals.css, que evitan
 * el zoom de iOS: acá el texto es más grande, así que no hay zoom.
 */
export function AmountField({ label, hint, currency, toggle, footer, inputRef, ...input }: {
  label: string;
  hint?: React.ReactNode;
  currency: "ARS" | "USD";
  /** El selector de moneda. */
  toggle?: React.ReactNode;
  footer?: React.ReactNode;
  inputRef?: React.Ref<HTMLInputElement>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "aria-label">) {
  return (
    <div className="rounded-[22px] bg-white/70 border border-white/80 pl-4 pr-3 pt-2.5 pb-3 focus-within:border-primary/50 transition-colors">
      <div className="flex items-center justify-between gap-2 min-h-[40px]">
        <span className="text-sm text-[#4A4658] min-w-0">{label}{hint && <span className="ml-1 text-xs">{hint}</span>}</span>
        {toggle}
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="tabular-nums text-[26px] font-medium text-muted-foreground shrink-0">{currency === "USD" ? "U$D" : "$"}</span>
        <input ref={inputRef} type="text" inputMode="decimal" pattern="[0-9.,]*" placeholder="0" aria-label={label} {...input}
          className="tabular-nums min-w-0 w-full bg-transparent !text-[38px] font-medium leading-tight tracking-[-0.03em] text-foreground placeholder:text-muted-foreground/40 outline-none" />
      </div>
      {footer}
    </div>
  );
}

/** Un interruptor con su explicación: el mismo de "Es un gasto fijo". */
export function SheetSwitch({ checked, disabled, onChange, title, children }: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={title} disabled={disabled} onClick={onChange}
      className="w-full flex items-center justify-between gap-3 rounded-[22px] bg-white/70 border border-white/80 min-h-[64px] px-4 py-2.5 text-left disabled:opacity-60">
      <span className="min-w-0">
        <span className="block font-semibold text-[15px] text-foreground">{title}</span>
        {children}
      </span>
      <span className={`relative shrink-0 w-[46px] h-7 rounded-full transition-colors ${checked ? "bg-primary" : "bg-ink/20"}`}>
        <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-sm transition-transform duration-150 ${checked ? "translate-x-[18px]" : ""}`} />
      </span>
    </button>
  );
}
