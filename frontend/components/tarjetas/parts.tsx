"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronLeft, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { getErrorMessage } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { FormSheet, FORM_SHEET_BODY } from "@/components/movimientos/FormSheet";
import { STATUS_CHIP, type SessionStatus } from "@/app/(app)/conciliar/shared";

/** "12 nov": una fecha chica, para una línea de texto. */
export function shortDate(iso: string): string {
  return format(parseISO(iso), "d MMM", { locale: es }).replace(".", "");
}

/** Pesos y dólares por separado: un resumen puede traer los dos y nunca se suman. */
export function totalsByCurrency(items: { amount: number | string; currency?: string | null }[]) {
  let ars = 0;
  let usd = 0;
  for (const item of items) {
    if (item.currency === "USD") usd += Number(item.amount);
    else ars += Number(item.amount);
  }
  return { ars, usd };
}

/** El encabezado de lo que se abre desde otra pantalla: volver, de qué se trata y lo que se puede hacer. */
export function SubHeader({ title, sub, backLabel, backHref, leading, children }: {
  title: string;
  sub?: React.ReactNode;
  backLabel: string;
  backHref: string;
  leading?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="-ml-2 md:-ml-3 -mt-3 md:-mt-4 flex items-center gap-1.5 md:gap-2.5">
      <button onClick={() => router.push(backHref)} aria-label={backLabel}
        className="w-11 h-11 shrink-0 rounded-full text-foreground flex items-center justify-center active:scale-[0.95] transition-transform duration-100">
        <ChevronLeft className="w-5 h-5" />
      </button>
      {leading}
      <div className="flex-1 min-w-0 pl-0.5">
        <h2 className="text-[22px] md:text-[26px] font-display font-medium leading-tight tracking-[-0.03em] text-foreground truncate">{title}</h2>
        {sub && <p className="text-sm text-muted-foreground truncate">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-1.5 shrink-0">{children}</div>}
    </div>
  );
}

const MENU = "w-44 z-50 rounded-2xl border border-white/70 bg-card/90 backdrop-blur-2xl backdrop-saturate-150 shadow-flota p-1.5 animate-fade-in";
const MENU_ITEM = "flex items-center gap-2.5 min-h-[44px] px-3 rounded-xl text-[15px] font-medium w-full text-left outline-none cursor-pointer data-[highlighted]:bg-ink/[0.06]";

/** El ⋮ de una fila: editar y eliminar quedan a mano sin pelearse con el toque que abre la fila. */
export function RowMenu({ label, onEdit, onDelete, editLabel = "Editar" }: {
  label: string;
  onEdit: () => void;
  onDelete: () => void;
  editLabel?: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button aria-label={label} title={label}
          className="w-11 h-11 shrink-0 -mr-2 rounded-full text-muted-foreground flex items-center justify-center outline-none active:bg-ink/[0.06] hover:bg-ink/[0.06] transition-colors">
          <MoreVertical className="w-[18px] h-[18px]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          <DropdownMenu.Item onSelect={onEdit} className={`${MENU_ITEM} text-foreground`}>
            <Pencil className="w-4 h-4 text-muted-foreground" /> {editLabel}
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={onDelete} className={`${MENU_ITEM} text-destructive`}>
            <Trash2 className="w-4 h-4" /> Eliminar
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// Ámbar es sólo el puntito de pendiente y verde sólo la plata que entra: acá lo
// que espera algo va en lila y lo que ya no espera nada, en neutro.
/** El estado de un resumen subido: la palabra sale de STATUS_CHIP, para que las pantallas no lo nombren distinto. */
export function StatusChip({ status, className }: { status: SessionStatus; className?: string }) {
  return (
    <Chip tone={STATUS_CHIP[status]?.tone ?? "neutral"} className={className}>
      {STATUS_CHIP[status]?.label ?? status}
    </Chip>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="rounded-2xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-sm text-rose-800">{children}</p>;
}

/**
 * Una opción de un conjunto chico en un formulario: se ve qué implica cada una
 * antes de elegirla. El `<input>` sigue siendo un radio de verdad, para el teclado.
 */
export function ChoiceRow({ name, checked, onChange, title, description }: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
}) {
  return (
    <label className={`flex items-start gap-3 rounded-[22px] border px-4 py-3 cursor-pointer transition-colors ${checked ? "bg-accent border-[#CFC9E4]" : "bg-white/70 border-white/80"}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 w-4 h-4 accent-[#1C1B25] shrink-0" />
      <span className="min-w-0">
        <span className="block font-semibold text-[15px] text-foreground">{title}</span>
        <span className="block text-sm leading-snug text-[#4A4658]">{description}</span>
      </span>
    </label>
  );
}

/**
 * Borrar una tarjeta o un resumen no es un sí o no: hay que decidir qué pasa con
 * los gastos que ya figuran en Egresos. Por eso es una hoja y no la confirmación
 * de la ficha.
 */
export function DeleteChoiceSheet({ title, intro, keep, remove, confirmLabel, onConfirm, onClose }: {
  title: string;
  intro: React.ReactNode;
  keep: string;
  remove: string;
  confirmLabel: string;
  /** Recibe si los gastos se quedan en Egresos. */
  onConfirm: (keepExpenses: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [keepExpenses, setKeepExpenses] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm(keepExpenses);
    } catch (e) {
      setError(getErrorMessage(e, "No se pudo eliminar. Probá de nuevo."));
      setDeleting(false);
    }
  };

  return (
    <FormSheet title={title} onClose={onClose}>
      <div className={FORM_SHEET_BODY}>
        <p className="px-1.5 text-[15px] leading-snug text-[#3F3B4B]">{intro}</p>
        <div className="space-y-2">
          <ChoiceRow name="keep" checked={keepExpenses} onChange={() => setKeepExpenses(true)}
            title="Mantener los gastos" description={keep} />
          <ChoiceRow name="keep" checked={!keepExpenses} onChange={() => setKeepExpenses(false)}
            title="Eliminar los gastos" description={remove} />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <div className="shrink-0 flex items-center gap-2 px-3.5 pt-2.5 pb-3.5 border-t border-ink/[0.08]">
        <button type="button" onClick={onClose}
          className="h-[52px] px-4 rounded-full font-semibold text-[15px] text-foreground active:scale-[0.98] transition-transform duration-100">
          Cancelar
        </button>
        <button type="button" onClick={confirm} disabled={deleting}
          className="flex-1 h-[52px] rounded-full bg-destructive text-destructive-foreground font-semibold text-[15.5px] disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
          {deleting ? "Eliminando…" : confirmLabel}
        </button>
      </div>
    </FormSheet>
  );
}
