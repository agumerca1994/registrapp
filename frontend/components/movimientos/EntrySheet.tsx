"use client";

import { Children, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowRight, Pencil, X } from "lucide-react";
import { useExitGhost } from "@/lib/motion";

/** Los centavos más chicos: lo que se lee primero es el número entero. */
function BigAmount({ text, positive }: { text: string; positive: boolean }) {
  const comma = text.lastIndexOf(",");
  const whole = comma >= 0 ? text.slice(0, comma) : text;
  const cents = comma >= 0 ? text.slice(comma) : "";
  return (
    <p className={`font-medium text-[44px] leading-[1.1] tracking-[-0.04em] tabular-nums break-words ${positive ? "text-emerald-800" : "text-foreground"}`}>
      {whole}
      {cents && <span className="text-2xl tracking-[-0.02em] text-muted-foreground">{cents}</span>}
    </p>
  );
}

/**
 * La ficha de un movimiento, en Egresos y en Ingresos: primero cuánto y qué, y
 * después sólo lo que agrega algo. La misma hoja de vidrio del + y de "Más".
 */
export function EntrySheet({ date, title, badge, amount, positive = false, onClose, children, footer }: {
  date: string;
  title: string;
  /** Lo que clasifica al movimiento: su categoría, o el tipo de la fuente. */
  badge?: { label: string; color?: string | null };
  amount: string;
  positive?: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // `toArray` descarta los `false` y aplana las listas: sin filas no se dibuja el bloque.
  const hasRows = Children.toArray(children).length > 0;
  // Un gasto sin descripción se titula con su categoría: repetirla abajo no dice nada.
  const showBadge = badge && badge.label !== title;
  const ghost = useExitGhost<HTMLDivElement>();
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          ref={ghost}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 p-2.5 animate-fade-in"
          style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}
        >
          <Dialog.Content
            aria-describedby={undefined}
            className="relative w-full sm:max-w-[400px] max-h-[88vh] overflow-y-auto rounded-[34px] border border-white/70 bg-card/85 backdrop-blur-2xl backdrop-saturate-150 shadow-flota px-3.5 pt-2.5 pb-3.5 animate-sheet-in outline-none"
          >
            <div className="sm:hidden w-10 h-1 rounded-full bg-ink/20 mx-auto mb-3" />
            <Dialog.Close aria-label="Cerrar"
              className="absolute right-3 top-3 w-10 h-10 rounded-full bg-ink/[0.07] text-foreground flex items-center justify-center active:scale-[0.95] transition-transform duration-100">
              <X className="w-[18px] h-[18px]" />
            </Dialog.Close>

            <div className="px-1.5 pb-3.5 sm:pt-2">
              <p className="font-marca text-xs text-muted-foreground pr-12">
                {format(parseISO(date), "EEE d MMM yyyy", { locale: es }).replace(/\./g, "")}
              </p>
              <div className="mt-2.5"><BigAmount text={amount} positive={positive} /></div>
              <Dialog.Title className="mt-1.5 text-[19px] font-semibold leading-snug tracking-[-0.01em] text-foreground">{title}</Dialog.Title>
              {showBadge && (
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/70 border border-white/80 px-2.5 py-1 text-[13px] font-medium text-foreground">
                  {badge.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: badge.color }} />}
                  {badge.label}
                </span>
              )}
            </div>

            {hasRows && (
              <div className="rounded-[22px] bg-white/70 border border-white/80 px-3.5 divide-y divide-ink/[0.08]">
                {children}
              </div>
            )}

            {footer && <div className="mt-2.5">{footer}</div>}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SheetRow({ label, children, strong = false }: { label: React.ReactNode; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
      <span className={`min-w-0 ${strong ? "font-semibold text-foreground" : "text-[#4A4658]"}`}>{label}</span>
      <span className={`text-right min-w-0 ${strong ? "font-semibold" : "font-medium"} text-foreground`}>{children}</span>
    </div>
  );
}

/**
 * Editar es lo que se viene a hacer. Eliminar queda al lado, sin peso, y pregunta
 * ahí mismo: sin la ventana del navegador y sin irse de la ficha. Lo que no se
 * edita no pasa `onEdit`, y lo que no se borra desde acá no pasa `onDelete`; `question` es para lo que
 * "este {noun}" no alcanza: una palabra femenina, o algo más que se borra con eso.
 */
export function SheetActions({ noun, question, keepLabel = "No, dejarlo", onEdit, onDelete }: {
  noun?: string;
  question?: string;
  keepLabel?: string;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="rounded-[22px] bg-rose-50 border border-rose-200 p-2.5" role="alert">
        <p className="px-1.5 pb-2 text-[15px] font-medium text-rose-900">{question ?? `¿Eliminar este ${noun}? No se puede deshacer.`}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" autoFocus onClick={() => setConfirming(false)}
            className="h-12 rounded-full bg-white border border-rose-200 font-semibold text-[15px] text-foreground active:scale-[0.98] transition-transform duration-100">
            {keepLabel}
          </button>
          <button type="button" onClick={onDelete}
            className="h-12 rounded-full bg-destructive text-destructive-foreground font-semibold text-[15px] active:scale-[0.98] transition-transform duration-100">
            Sí, eliminar
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {onDelete && (
        <button type="button" onClick={() => setConfirming(true)}
          className="h-[52px] px-4 rounded-full font-semibold text-[15px] text-destructive active:scale-[0.98] transition-transform duration-100">
          Eliminar
        </button>
      )}
      {onEdit && (
        <button type="button" onClick={onEdit}
          className="flex-1 h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform duration-100">
          <Pencil className="w-4 h-4" /> Editar
        </button>
      )}
    </div>
  );
}

/** Lo que vive en otro lado (el resumen de una tarjeta) se dice, y lleva hasta ahí. */
export function SheetLink({ note, label, onClick }: { note: string; label: string; onClick: () => void }) {
  return (
    <div>
      <p className="px-1.5 pb-2.5 text-sm leading-snug text-[#4A4658]">{note}</p>
      <button type="button" onClick={onClick}
        className="w-full h-[52px] pl-5 pr-[7px] rounded-full bg-ink text-background font-semibold text-[15.5px] flex items-center justify-between active:scale-[0.98] transition-transform duration-100">
        {label}
        <span className="w-[38px] h-[38px] rounded-full bg-background text-ink flex items-center justify-center">
          <ArrowRight className="w-[17px] h-[17px]" />
        </span>
      </button>
    </div>
  );
}
