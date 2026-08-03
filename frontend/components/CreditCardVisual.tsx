"use client";

import { Pencil, Trash2 } from "lucide-react";
import { BankLogo } from "@/components/ui/bank-logo";

interface CardData {
  id: number;
  bank: string;
  alias: string;
  titular?: string;
  last_4_digits?: string;
}

// Full-width row, stacked one below the other — styled like a card
// (border-ink + shadow-hero) rather than a plain table row. Bank shown as
// a small icon/initials badge (see BankLogo). Number + titular move to a
// second line under the name on narrow screens instead of being hidden,
// same pattern used for the income/expenses list rows.
export function CreditCardVisual({
  card,
  onClick,
  onEdit,
  onDelete,
}: {
  card: CardData;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="relative rounded-2xl border-2 border-ink shadow-hero bg-card overflow-hidden cursor-pointer transition-transform hover:-translate-y-0.5 p-3 sm:p-4 flex items-center gap-3 sm:gap-4"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
    >
      <BankLogo bankName={card.bank} size={40} className="shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground truncate">{card.bank}</p>
        <p className="text-xs text-muted-foreground truncate">{card.alias}</p>
        <div className="sm:hidden mt-0.5">
          <p className="text-xs font-mono font-medium text-foreground">•••• {card.last_4_digits || "••••"}</p>
          <p className="text-xs text-muted-foreground truncate">{card.titular || "Sin titular"}</p>
        </div>
      </div>

      <div className="hidden sm:block shrink-0 text-right">
        <p className="text-sm font-mono font-semibold tracking-wider text-foreground">•••• {card.last_4_digits || "••••"}</p>
        <p className="text-xs font-medium text-muted-foreground uppercase truncate max-w-[160px]">{card.titular || "Sin titular"}</p>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Editar tarjeta"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
          title="Eliminar tarjeta"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
