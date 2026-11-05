"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { formatARS, formatUSD } from "@/lib/utils";

/** Los centavos sólo cuando los hay: "$ 12.000", pero "$ 827.461,40". El detalle de cada fila los muestra siempre. */
export function ledgerAmount(amount: number | string, currency?: string | null): string {
  const text = currency === "USD" ? formatUSD(amount) : formatARS(amount);
  return text.replace(/,00$/, "");
}

/**
 * Una fila de la lista de movimientos, con el formato de "Lo que viene" en Inicio:
 * la fecha en itálica a la izquierda, sin recuadro y separada por líneas finas.
 *
 * `showDate` es falso en la segunda fila de un mismo día: un número repetido en
 * cada renglón no dice nada. Para un lector de pantalla la fecha va siempre.
 */
export function LedgerRow({ date, showDate = true, title, sub, amount, positive = false, onOpen, selecting = false, selected = false, selectable = true, onToggle }: {
  date: string;
  showDate?: boolean;
  title: string;
  sub?: React.ReactNode;
  amount: string;
  positive?: boolean;
  onOpen: () => void;
  selecting?: boolean;
  selected?: boolean;
  /** Lo que viene de una tarjeta no se borra desde acá: se hace en su resumen. */
  selectable?: boolean;
  onToggle?: () => void;
}) {
  const d = parseISO(date);
  const otherYear = d.getFullYear() !== new Date().getFullYear();
  const dateLabel = `${format(d, "d")} ${format(d, otherYear ? "MMM yy" : "MMM", { locale: es }).replace(".", "")}`;
  return (
    <div className="flex items-center gap-3 border-b border-border last:border-b-0">
      {selecting && (
        <span className="w-5 shrink-0 flex justify-center">
          {selectable && (
            <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Seleccionar ${title}`}
              className="w-[18px] h-[18px] rounded-md accent-[#1C1B25] cursor-pointer" />
          )}
        </span>
      )}
      <button type="button" data-no-press onClick={onOpen}
        className="flex-1 min-w-0 min-h-[64px] py-2 flex items-center gap-3 md:gap-4 text-left active:opacity-60 transition-opacity">
        <span className="w-[46px] shrink-0">
          <span className="sr-only">{dateLabel} </span>
          {showDate && (
            <span aria-hidden="true">
              <span className="block font-fecha italic text-[30px] leading-none text-[#3B2FB3]">{format(d, "d")}</span>
              <span className="font-marca text-xs text-muted-foreground whitespace-nowrap">{dateLabel.split(" ").slice(1).join(" ")}</span>
            </span>
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-[15.5px] text-foreground truncate">{title}</span>
          {sub && <span className="block text-sm text-muted-foreground truncate">{sub}</span>}
        </span>
        <span className={`shrink-0 font-medium text-base text-right tabular-nums ${positive ? "text-emerald-800" : "text-foreground"}`}>
          {amount}
        </span>
      </button>
    </div>
  );
}

export function LedgerTotal({ label, ars, usd, positive = false }: { label: string; ars: number; usd: number; positive?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pt-3 mt-1 border-t-2 border-foreground/80">
      <span className="text-[15.5px] font-semibold text-foreground">{label}</span>
      <span className={`text-right font-semibold tabular-nums ${positive ? "text-emerald-800" : "text-foreground"}`}>
        {ars > 0 && <span className="block text-lg">{ledgerAmount(ars)}</span>}
        {usd > 0 && <span className="block text-sm">{ledgerAmount(usd, "USD")}</span>}
      </span>
    </div>
  );
}

/** La barra de la selección: aparece sólo después de elegir "Seleccionar varios" en el menú. */
export function SelectionBar({ count, allSelected, deleting, onToggleAll, onDelete, onCancel }: {
  count: number;
  allSelected: boolean;
  deleting: boolean;
  onToggleAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-accent px-3.5 py-2 text-sm flex-wrap">
      <label className="flex items-center gap-2 font-medium cursor-pointer">
        <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="w-[18px] h-[18px] rounded-md accent-[#1C1B25]" />
        {count > 0 ? `${count} ${count === 1 ? "elegido" : "elegidos"}` : "Elegir todos"}
      </label>
      <span className="ml-auto flex items-center gap-1">
        {count > 0 && (
          <button type="button" onClick={onDelete} disabled={deleting}
            className="min-h-[36px] px-3 rounded-full font-semibold text-destructive disabled:opacity-50">
            {deleting ? "Eliminando…" : "Eliminar"}
          </button>
        )}
        <button type="button" onClick={onCancel} className="min-h-[36px] px-3 rounded-full font-semibold text-foreground">Listo</button>
      </span>
    </div>
  );
}
