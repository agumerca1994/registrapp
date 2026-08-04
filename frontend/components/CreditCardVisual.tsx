"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Pencil, Trash2, MoreVertical } from "lucide-react";
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

      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none" title="Más acciones">
              <MoreVertical className="w-4 h-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className="bg-card border rounded-xl shadow-lg p-1 w-40 z-50">
              <DropdownMenu.Item asChild>
                <button onClick={onEdit}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-foreground hover:bg-accent w-full text-left outline-none cursor-pointer">
                  <Pencil className="w-4 h-4 text-muted-foreground" /> Editar
                </button>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild>
                <button onClick={onDelete}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 w-full text-left outline-none cursor-pointer">
                  <Trash2 className="w-4 h-4" /> Eliminar
                </button>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
