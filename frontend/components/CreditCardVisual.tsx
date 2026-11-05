"use client";

import { BankLogo } from "@/components/ui/bank-logo";
import { ledgerAmount } from "@/components/movimientos/Ledger";
import { RowMenu, shortDate } from "@/components/tarjetas/parts";

interface CardData {
  id: number;
  bank: string;
  alias: string;
  titular?: string;
  last_4_digits?: string;
}

/** Lo próximo que vence de esta tarjeta, si se sabe. Pesos y dólares por separado. */
export interface CardNextDue {
  date: string;
  estimated: boolean;
  ars: number;
  usd: number;
}

// Una fila de la lista de tarjetas, sobre el papel y con líneas finas, como todas
// las listas. A la derecha, lo que se viene a mirar: cuánto vence y cuándo.
export function CreditCardVisual({
  card,
  next,
  onClick,
  onEdit,
  onDelete,
}: {
  card: CardData;
  next?: CardNextDue;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Una tarjeta llamada igual que su banco no dice dos veces lo mismo.
  const detail = [
    card.alias !== card.bank ? card.bank : null,
    card.last_4_digits ? `•••• ${card.last_4_digits}` : null,
    card.titular,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex items-center gap-1 border-b border-border last:border-b-0">
      <button type="button" data-no-press onClick={onClick}
        className="flex-1 min-w-0 min-h-[72px] py-2 flex items-center gap-3 text-left active:opacity-60 transition-opacity">
        <BankLogo bankName={card.bank} size={44} className="shrink-0 border border-border" />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-[15.5px] text-foreground truncate">{card.alias}</span>
          {detail && <span className="block text-sm text-muted-foreground truncate">{detail}</span>}
        </span>
        {next && (
          <span className="shrink-0 text-right">
            {next.ars > 0 && <span className="block font-medium text-base tabular-nums text-foreground">{ledgerAmount(next.ars)}</span>}
            {next.usd > 0 && <span className="block font-medium text-base tabular-nums text-foreground">{ledgerAmount(next.usd, "USD")}</span>}
            <span className="block font-marca text-xs text-muted-foreground">
              {next.estimated ? "estimado " : "vence "}{shortDate(next.date)}
            </span>
          </span>
        )}
      </button>
      <RowMenu label={`Más acciones de ${card.alias}`} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}
