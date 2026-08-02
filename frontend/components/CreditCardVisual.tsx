"use client";

import { Pencil, Trash2 } from "lucide-react";
import { BankLogo } from "@/components/ui/bank-logo";
import { findBank } from "@/lib/banks";

interface CardData {
  id: number;
  bank: string;
  alias: string;
  titular?: string;
  last_4_digits?: string;
}

// Blends a hex color toward black by `amount` (0-1) — used to build the
// card's gradient dark stop so white text stays legible even for light
// brand colors (e.g. Banco Ciudad's yellow, Wilobank's mint).
function darken(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `rgb(${r}, ${g}, ${b})`;
}

const DEFAULT_COLOR = "#5B4FE9";

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
  const bank = findBank(card.bank);
  const color = bank?.color || DEFAULT_COLOR;
  const gradient = `linear-gradient(135deg, ${color} 0%, ${darken(color, 0.55)} 100%)`;

  return (
    <div
      className="relative aspect-[1.586/1] rounded-2xl border-2 border-ink shadow-hero overflow-hidden text-white cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{ background: gradient }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
    >
      {/* Bottom scrim so text stays legible over any brand color */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/5 to-black/10 pointer-events-none" />

      <div className="absolute top-3 left-3 right-3 flex items-start justify-between">
        <BankLogo bankName={card.bank} size={36} />
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 rounded-full bg-white/15 hover:bg-white/30 backdrop-blur-sm transition-colors"
            title="Editar tarjeta"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 rounded-full bg-white/15 hover:bg-white/30 backdrop-blur-sm transition-colors"
            title="Eliminar tarjeta"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* EMV chip — purely decorative, mimics a real card */}
      <div className="absolute top-[38%] left-3 w-8 h-6 rounded-md bg-gradient-to-br from-amber-200 to-amber-500 opacity-90" />

      <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 mt-2 text-lg sm:text-xl font-mono font-medium tracking-widest [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]">
        •••• •••• •••• {card.last_4_digits || "••••"}
      </div>

      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
        <p className="text-xs sm:text-sm font-semibold uppercase tracking-wide truncate [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
          {card.titular || "Sin titular"}
        </p>
        <p className="text-[11px] sm:text-xs font-medium opacity-90 truncate max-w-[45%] text-right [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
          {card.alias}
        </p>
      </div>
    </div>
  );
}
